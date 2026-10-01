//! Seven-segment displays: LED (common cathode) and liquid crystal.

use super::diode::led_model;
use super::junction::Junction;
use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

const SEG_KEYS: [&str; 7] = ["seg_a", "seg_b", "seg_c", "seg_d", "seg_e", "seg_f", "seg_g"];

/// Seven LEDs to a common cathode, each through a built-in resistor.
/// Pins: a..g, common; hidden nodes 8..14 sit between each LED and its resistor.
#[derive(Debug)]
pub struct SevenSeg {
    segs: [Junction; 7],
    rs: f64,
}

impl Default for SevenSeg {
    fn default() -> Self {
        Self { segs: [Junction::new(1e-14, 0.05); 7], rs: 330.0 }
    }
}

impl Model for SevenSeg {
    fn configure(&mut self, p: &Params) {
        let (is, nvt) = led_model(&p.text("color"));
        for j in &mut self.segs {
            j.is = is;
            j.nvt = nvt;
        }
        self.rs = p.num("Rs", 330.0).max(1e-3);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let com = io.nodes[7];
        let mut lim = false;
        for (i, j) in self.segs.iter_mut().enumerate() {
            let inner = io.nodes[8 + i];
            lim = j.stamp(s, io.nodes[i], inner, io.vd(c.x, i, 8 + i)) || lim;
            s.g(inner, com, 1.0 / self.rs);
        }
        io.limited = lim;
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        io.zero();
        if io.broken {
            return;
        }
        let mut sum = 0.0;
        for (i, j) in self.segs.iter_mut().enumerate() {
            let v = io.vd(c.x, i, 8 + i);
            j.v_last = v;
            let cur = j.current(v);
            io.cur[i] = cur;
            sum += cur;
        }
        io.cur[7] = -sum;
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        for (i, j) in self.segs.iter().enumerate() {
            s.yr(io.nodes[i], io.nodes[8 + i], j.g());
            s.yr(io.nodes[8 + i], io.nodes[7], 1.0 / self.rs);
        }
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[..7].iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (i > 0.06).then(|| Issue::burn("burn.led", &[("i", i), ("max", 0.02)]))
    }
    fn extra(&self, _c: &Ctx, io: &Io, out: &mut Extra) {
        for (i, k) in SEG_KEYS.iter().enumerate() {
            out.push((k, io.cur[i].max(0.0) / 0.01));
        }
    }
}

/// Liquid-crystal 7-segment display: a segment darkens with the RMS voltage across it.
/// Pins: a..g, common (backplane).
#[derive(Debug, Default)]
pub struct Lcd7 {
    sq: [f64; 7],
}

impl Model for Lcd7 {
    fn configure(&mut self, _p: &Params) {}
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        for i in 0..7 {
            s.g(io.nodes[i], io.nodes[7], 1e-8);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let com = io.v(c.x, 7);
        // Liquid crystal responds in a few tens of milliseconds.
        let k = (c.dt / 0.02).min(1.0);
        let mut sum = 0.0;
        io.zero();
        for i in 0..7 {
            let v = io.v(c.x, i) - com;
            self.sq[i] += k * (v * v - self.sq[i]);
            io.cur[i] = v * 1e-8;
            sum += io.cur[i];
        }
        io.cur[7] = -sum;
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        for i in 0..7 {
            s.yr(io.nodes[i], io.nodes[7], 1e-8);
        }
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        // Liquid crystal turns from clear to dark between about 1 V and 2.5 V RMS.
        for (i, k) in SEG_KEYS.iter().enumerate() {
            out.push((k, ((self.sq[i].sqrt() - 1.0) / 1.5).clamp(0.0, 1.0)));
        }
    }
    fn save(&self) -> Vec<f64> {
        self.sq.to_vec()
    }
    fn load(&mut self, s: &[f64]) {
        if s.len() == 7 {
            self.sq.copy_from_slice(s);
        }
    }
}
