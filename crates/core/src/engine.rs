//! Transient simulator. Each step solves the nodal equations with Newton's method,
//! then lets every part update its memory (capacitor voltage, gate output...).

use crate::catalog::catalog;
use crate::devices::{self, Ctx, Extra, Io, Issue, Level, Model};
use crate::doc::{CircuitDoc, ParamValue, Params};
use crate::fault::Fault;
use crate::linalg::{LuSolver, solve_complex};
use crate::netlist::{Netlist, Node, build_netlist};
use crate::stamp::{AcStamper, Stamper};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

const MAX_ITER: usize = 80;
/// After this many Newton iterations, take half steps so stubborn circuits still settle.
const DAMP_AFTER: usize = 25;
/// A tiny leak from every node to ground keeps isolated pieces solvable.
const NODE_LEAK: f64 = 1e-12;

/// One placed part with its model.
pub struct Device {
    pub id: String,
    pub kind: String,
    pub params: Params,
    pub io: Io,
    pub model: Box<dyn Model>,
    /// A hidden fault set by a repair challenge; the model is bypassed while it lasts.
    pub fault: Fault,
}

/// Why the simulation stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Failure {
    /// The equations have no unique solution (a floating part or a loop of ideal sources).
    Singular,
    /// Newton's method ran off to infinity.
    Diverged,
}

impl Failure {
    /// Key of the translated message.
    pub fn key(self) -> &'static str {
        match self {
            Failure::Singular => "fail.singular",
            Failure::Diverged => "fail.diverged",
        }
    }
}

/// An issue attached to the part it concerns.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PartIssue {
    pub part: String,
    #[serde(flatten)]
    pub issue: Issue,
}

/// Voltage across, current through and power of a part (two-pin parts: pin 1 minus pin 2).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Reading {
    pub v: f64,
    pub i: f64,
    pub p: f64,
    #[serde(serialize_with = "crate::devices::pairs_as_map")]
    pub extra: Extra,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct BodePoint {
    pub f: f64,
    pub db: f64,
    pub phase: f64,
}

/// Part memories kept when the wiring changes, by part id.
pub type SavedState = HashMap<String, Vec<f64>>;

pub struct Engine {
    pub net: Netlist,
    pub devices: Vec<Device>,
    index: HashMap<String, usize>,
    /// Number of unknowns: wired nodes plus hidden nodes inside parts.
    pub n: usize,
    pub x: Vec<f64>,
    pub t: f64,
    pub dt: f64,
    pub failure: Option<Failure>,
    /// Steps that did not fully converge since the last reset.
    pub rough_steps: u64,
    /// Newton iterations since the last reset (for tuning).
    pub iterations: u64,
    stamper: Stamper,
    pub lu: LuSolver,
    guess: Vec<f64>,
    nonlinear: bool,
    /// For each infrared receiver (by device index), the transmitters on its channel.
    ir_links: Vec<(usize, Vec<usize>)>,
    /// Infrared light reaching each device during the present step.
    lights: Vec<f64>,
}

impl Engine {
    pub fn new(doc: &CircuitDoc, dt: f64, broken: &HashSet<String>) -> Self {
        let cat = catalog();
        let net = build_netlist(doc);
        // Some parts need hidden nodes of their own (e.g. between each LED segment and its resistor).
        let mut next = net.node_count;
        let mut devices = Vec::with_capacity(doc.parts.len());
        for (i, p) in doc.parts.iter().enumerate() {
            let k = cat.def(&p.kind).internal_nodes;
            let mut nodes = net.pin_nodes[i].clone();
            nodes.extend((next..next + k).map(|v| v as Node));
            next += k;
            let pins = cat.pin_count(&p.kind);
            let model = devices::create(&p.kind, &p.params, pins);
            let len = nodes.len();
            devices.push(Device {
                id: p.id.clone(),
                kind: p.kind.clone(),
                params: p.params.clone(),
                io: Io { index: i, nodes, cur: vec![0.0; len], broken: broken.contains(&p.id), limited: false },
                model,
                fault: Fault::from_params(&p.params),
            });
        }
        let n = next;
        let index = devices.iter().enumerate().map(|(i, d)| (d.id.clone(), i)).collect();
        let nonlinear = devices.iter().any(|d| d.model.nonlinear());
        let mut e = Engine {
            net,
            devices,
            index,
            n,
            x: vec![0.0; n],
            t: 0.0,
            dt,
            failure: None,
            rough_steps: 0,
            iterations: 0,
            stamper: Stamper::new(n),
            lu: LuSolver::new(n),
            guess: vec![0.0; n],
            nonlinear,
            ir_links: Vec::new(),
            lights: Vec::new(),
        };
        e.link_ir();
        e
    }

    pub fn from_doc(doc: &CircuitDoc) -> Self {
        Self::new(doc, doc.choose_dt(), &HashSet::new())
    }

    fn link_ir(&mut self) {
        self.lights = vec![0.0; self.devices.len()];
        self.ir_links = self
            .devices
            .iter()
            .enumerate()
            .filter_map(|(i, d)| {
                let ch = d.model.ir_rx_channel()?;
                let tx = self.devices.iter().enumerate().filter(|(_, t)| t.model.ir_tx_channel() == Some(ch)).map(|(j, _)| j).collect();
                Some((i, tx))
            })
            .collect();
    }

    /// Light reaching device `i` from the transmitters' present currents.
    fn ir_light(devices: &[Device], links: &[(usize, Vec<usize>)], i: usize) -> f64 {
        let Some((_, tx)) = links.iter().find(|(r, _)| *r == i) else { return 0.0 };
        tx.iter().map(|&j| &devices[j].io).filter(|io| !io.broken).map(|io| io.cur[0].max(0.0)).sum()
    }

    pub fn device(&self, id: &str) -> Option<&Device> {
        self.index.get(id).map(|&i| &self.devices[i])
    }

    pub fn device_index(&self, id: &str) -> Option<usize> {
        self.index.get(id).copied()
    }

    /// Change one value without restarting (a knob turned, a switch flipped).
    pub fn set_param(&mut self, id: &str, key: &str, value: ParamValue) -> bool {
        let Some(&i) = self.index.get(id) else { return false };
        let d = &mut self.devices[i];
        d.params.insert(key.to_string(), value);
        d.model.configure(&d.params);
        d.fault = Fault::from_params(&d.params);
        if key == "ch" {
            self.link_ir();
        }
        true
    }

    /// Point parts at the edited document's values (values changed, wiring did not).
    pub fn sync_params(&mut self, doc: &CircuitDoc) {
        for p in &doc.parts {
            if let Some(&i) = self.index.get(&p.id) {
                let d = &mut self.devices[i];
                if d.params != p.params {
                    d.params = p.params.clone();
                    d.model.configure(&d.params);
                    d.fault = Fault::from_params(&d.params);
                }
            }
        }
        self.link_ir();
    }

    /// Keep capacitor charge, gate states etc. when the wiring changes.
    pub fn export_state(&self) -> SavedState {
        self.devices.iter().map(|d| (d.id.clone(), d.model.save())).collect()
    }

    pub fn import_state(&mut self, state: &SavedState, t: f64) {
        for d in &mut self.devices {
            if let Some(s) = state.get(&d.id) {
                d.model.load(s);
            }
        }
        self.t = t;
    }

    pub fn set_broken(&mut self, id: &str, broken: bool) {
        if let Some(&i) = self.index.get(id) {
            self.devices[i].io.broken = broken;
        }
    }

    /// Advance one time step. Returns parts that were damaged in this step.
    pub fn step(&mut self) -> Vec<PartIssue> {
        if self.failure.is_some() {
            return Vec::new();
        }
        let n = self.n;
        let t1 = self.t + self.dt;
        let dt = self.dt;
        let Engine { devices, stamper, lu, guess, x, ir_links, lights, .. } = self;
        guess.copy_from_slice(x);
        // Transmitter currents do not change while stamping, so light is computed once per step.
        for (r, _) in ir_links.iter() {
            lights[*r] = Self::ir_light(devices, ir_links, *r);
        }
        let mut converged = n == 0;
        if n > 0 {
            for iter in 0..MAX_ITER {
                self.iterations += 1;
                stamper.clear();
                for (d, &ir_light) in devices.iter_mut().zip(lights.iter()) {
                    d.io.limited = false;
                    if d.fault != Fault::None {
                        d.fault.stamp(stamper, &d.io.nodes);
                        continue;
                    }
                    let ctx = Ctx { t: t1, dt, x: guess, ir_light };
                    d.model.stamp(stamper, &ctx, &mut d.io);
                }
                for i in 0..n {
                    stamper.g[i * n + i] += NODE_LEAK;
                }
                if !lu.solve(&stamper.g, &mut stamper.b) {
                    self.failure = Some(Failure::Singular);
                    return Vec::new();
                }
                let next = &stamper.b;
                let mut ok = !devices.iter().any(|d| d.io.limited);
                for i in 0..n {
                    if !next[i].is_finite() {
                        self.failure = Some(Failure::Diverged);
                        return Vec::new();
                    }
                    if (next[i] - guess[i]).abs() > 1e-6 + 1e-4 * next[i].abs() {
                        ok = false;
                    }
                }
                if iter >= DAMP_AFTER {
                    for i in 0..n {
                        guess[i] += 0.5 * (next[i] - guess[i]);
                    }
                } else {
                    guess.copy_from_slice(next);
                }
                if !self.nonlinear || (ok && iter > 0) {
                    converged = true;
                    break;
                }
            }
        }
        if !converged {
            self.rough_steps += 1;
        }
        x.copy_from_slice(guess);
        self.t = t1;
        let mut damaged = Vec::new();
        for i in 0..devices.len() {
            let ir_light = if ir_links.is_empty() { 0.0 } else { Self::ir_light(devices, ir_links, i) };
            let ctx = Ctx { t: t1, dt, x, ir_light };
            let d = &mut devices[i];
            if d.fault != Fault::None {
                d.fault.accept(x, &d.io.nodes, &mut d.io.cur);
                continue;
            }
            d.model.accept(&ctx, &mut d.io);
            if d.io.broken {
                continue;
            }
            if let Some(issue) = d.model.limits(&ctx, &d.io) {
                if issue.level == Level::Burn {
                    d.io.broken = true;
                    damaged.push(PartIssue { part: d.id.clone(), issue });
                }
            }
        }
        damaged
    }

    /// Context for reading values after a step.
    fn ctx_for(&self, i: usize) -> Ctx<'_> {
        let ir_light = if self.ir_links.is_empty() { 0.0 } else { Self::ir_light(&self.devices, &self.ir_links, i) };
        Ctx { t: self.t, dt: self.dt, x: &self.x, ir_light }
    }

    /// Frequency response between two nodes, driven by part `stimulus` with every other source
    /// switched off. Uses the present operating point for diodes and transistors.
    pub fn ac_sweep(&self, stimulus: &str, in_node: Node, out_node: Node, freqs: &[f64]) -> Vec<BodePoint> {
        let mut out = Vec::with_capacity(freqs.len());
        let n = self.n;
        if n == 0 {
            return out;
        }
        let Some(stim) = self.device_index(stimulus) else { return out };
        let mut s = AcStamper::new(n, stim);
        for &f in freqs {
            let w = 2.0 * std::f64::consts::PI * f;
            s.clear();
            for d in &self.devices {
                if d.fault != Fault::None {
                    d.fault.ac(&mut s, &d.io.nodes);
                } else if !d.io.broken {
                    d.model.ac(&mut s, w, &d.io);
                }
            }
            for i in 0..n {
                s.gr[i * n + i] += NODE_LEAK;
            }
            let AcStamper { gr, gi, br, bi, .. } = &mut s;
            if !solve_complex(gr, gi, br, bi, n) {
                continue;
            }
            let at = |node: Node| if node < 0 { (0.0, 0.0) } else { (br[node as usize], bi[node as usize]) };
            let vi = at(in_node);
            let vo = at(out_node);
            let den = vi.0 * vi.0 + vi.1 * vi.1;
            if den < 1e-30 {
                continue;
            }
            let hr = (vo.0 * vi.0 + vo.1 * vi.1) / den;
            let hi = (vo.1 * vi.0 - vo.0 * vi.1) / den;
            let mag = hr.hypot(hi);
            out.push(BodePoint { f, db: 20.0 * mag.max(1e-12).log10(), phase: hi.atan2(hr).to_degrees() });
        }
        out
    }

    /// Voltage of a node (ground is 0).
    pub fn volt(&self, node: Node) -> f64 {
        if node < 0 { 0.0 } else { self.x.get(node as usize).copied().unwrap_or(0.0) }
    }

    /// Advice for the circuit doctor, from the latest state.
    pub fn advice(&self) -> Vec<PartIssue> {
        self.devices
            .iter()
            .enumerate()
            .filter(|(_, d)| !d.io.broken && d.fault == Fault::None)
            .filter_map(|(i, d)| d.model.advice(&self.ctx_for(i), &d.io).map(|issue| PartIssue { part: d.id.clone(), issue }))
            .collect()
    }

    /// Live values of a part (brightness, meter reading, logic level...).
    pub fn extra(&self, id: &str) -> Extra {
        let mut out = Extra::new();
        if let Some(&i) = self.index.get(id) {
            let d = &self.devices[i];
            d.model.extra(&self.ctx_for(i), &d.io, &mut out);
        }
        out
    }

    pub fn extra_value(&self, id: &str, key: &str) -> Option<f64> {
        self.extra(id).into_iter().find(|(k, _)| *k == key).map(|(_, v)| v)
    }

    pub fn reading(&self, id: &str) -> Option<Reading> {
        let d = self.device(id)?;
        let nodes = &d.io.nodes;
        let v = match nodes.len() {
            0 => 0.0,
            1 => self.volt(nodes[0]),
            _ => self.volt(nodes[0]) - self.volt(nodes[1]),
        };
        let i = d.io.cur.first().copied().unwrap_or(0.0);
        Some(Reading { v, i, p: v * i, extra: self.extra(id) })
    }

    /// Current in every wire of `doc` (same order as `doc.wires`).
    pub fn wire_currents(&self, doc: &CircuitDoc) -> Vec<f64> {
        let cur: Vec<&[f64]> = doc.parts.iter().map(|p| self.device(&p.id).map_or(&[][..], |d| d.io.cur.as_slice())).collect();
        self.net.wire_currents(doc, &cur)
    }
}
