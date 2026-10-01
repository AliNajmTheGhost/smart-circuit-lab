//! Digital parts: gates, flip-flops, counter, BCD decoder, A/D and D/A converters, logic switch
//! and probe.
//!
//! Inputs are high-impedance with TTL thresholds; outputs are 0 V or 5 V behind 100 Ω.
//! New outputs are computed after each step, a small realistic propagation delay.

use super::{Ctx, Extra, Io, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

pub const LOGIC_HIGH: f64 = 5.0;
const LOGIC_ROUT: f64 = 100.0;
const INPUT_G: f64 = 1e-6;

/// Reads a logic level with TTL thresholds; in-between voltages keep the previous level.
#[inline]
pub fn level(v: f64, prev: u8) -> u8 {
    if v >= 2.0 {
        1
    } else if v <= 0.8 {
        0
    } else {
        prev
    }
}

/// What makes one digital chip different from another: how outputs follow inputs.
pub trait Logic: Send {
    fn configure(&mut self, _p: &Params) {}
    /// New outputs from the new input levels (`prev` holds the levels before this step).
    fn logic(&mut self, prev: &[u8], inp: &[u8], out: &mut [u8]);
    fn extra(&self, inp: &[u8], out: &[u8], dst: &mut Extra);
    /// Analogue pins beyond the logic inputs and outputs (converter input or output).
    fn stamp_more(&self, _s: &mut Stamper, _io: &Io) {}
    fn accept_more(&mut self, _c: &Ctx, _io: &mut Io) {}
    fn before_accept(&mut self, _c: &Ctx, _io: &Io) {}
    fn ac_more(&self, _s: &mut AcStamper, _io: &Io) {}
    fn save_more(&self, _dst: &mut Vec<f64>) {}
    fn load_more(&mut self, _s: &[f64]) {}
}

pub struct Digital<L: Logic> {
    ins: Vec<usize>,
    outs: Vec<usize>,
    inp: Vec<u8>,
    out: Vec<u8>,
    prev: Vec<u8>,
    logic: L,
}

impl<L: Logic> Digital<L> {
    fn new(ins: Vec<usize>, outs: Vec<usize>, out: Vec<u8>, logic: L) -> Self {
        debug_assert_eq!(outs.len(), out.len());
        Self { inp: vec![0; ins.len()], prev: vec![0; ins.len()], ins, outs, out, logic }
    }
}

impl<L: Logic> Model for Digital<L> {
    fn configure(&mut self, p: &Params) {
        self.logic.configure(p);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        let g = 1.0 / LOGIC_ROUT;
        for (i, &pin) in self.outs.iter().enumerate() {
            let o = io.nodes[pin];
            s.g(o, -1, g);
            s.flow(-1, o, f64::from(self.out[i]) * LOGIC_HIGH * g);
        }
        for &pin in &self.ins {
            s.g(io.nodes[pin], -1, INPUT_G);
        }
        self.logic.stamp_more(s, io);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        self.logic.before_accept(c, io);
        io.zero();
        self.prev.copy_from_slice(&self.inp);
        for (i, &pin) in self.ins.iter().enumerate() {
            let v = io.v(c.x, pin);
            self.inp[i] = level(v, self.inp[i]);
            io.cur[pin] = v * INPUT_G;
        }
        for (i, &pin) in self.outs.iter().enumerate() {
            io.cur[pin] = (io.v(c.x, pin) - f64::from(self.out[i]) * LOGIC_HIGH) / LOGIC_ROUT;
        }
        self.logic.logic(&self.prev, &self.inp, &mut self.out);
        // After the logic, so the D/A output current uses the new code.
        self.logic.accept_more(c, io);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        for &pin in &self.outs {
            s.yr(io.nodes[pin], -1, 1.0 / LOGIC_ROUT);
        }
        for &pin in &self.ins {
            s.yr(io.nodes[pin], -1, INPUT_G);
        }
        self.logic.ac_more(s, io);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        self.logic.extra(&self.inp, &self.out, out);
    }
    fn save(&self) -> Vec<f64> {
        let mut v: Vec<f64> = self.inp.iter().chain(&self.out).map(|&b| f64::from(b)).collect();
        self.logic.save_more(&mut v);
        v
    }
    fn load(&mut self, s: &[f64]) {
        let (ni, no) = (self.inp.len(), self.out.len());
        if s.len() < ni + no {
            return;
        }
        let bit = |v: f64| u8::from(v != 0.0);
        for (dst, &v) in self.inp.iter_mut().zip(&s[..ni]) {
            *dst = bit(v);
        }
        for (dst, &v) in self.out.iter_mut().zip(&s[ni..ni + no]) {
            *dst = bit(v);
        }
        self.logic.load_more(&s[ni + no..]);
    }
}

#[inline]
fn rising(prev: &[u8], inp: &[u8], i: usize) -> bool {
    prev[i] == 0 && inp[i] == 1
}

fn bits4(value: u32, out: &mut [u8]) {
    for (b, o) in out.iter_mut().enumerate() {
        *o = ((value >> b) & 1) as u8;
    }
}

// ---------------------------------------------------------------- gates

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateFn {
    And,
    Or,
    Not,
    Nand,
    Nor,
    Xor,
    Xnor,
}

impl GateFn {
    pub fn from_kind(kind: &str) -> Option<Self> {
        Some(match kind {
            "and" => GateFn::And,
            "or" => GateFn::Or,
            "not" => GateFn::Not,
            "nand" => GateFn::Nand,
            "nor" => GateFn::Nor,
            "xor" => GateFn::Xor,
            "xnor" => GateFn::Xnor,
            _ => return None,
        })
    }

    fn eval(self, a: u8, b: u8) -> u8 {
        match self {
            GateFn::And => a & b,
            GateFn::Or => a | b,
            GateFn::Not => 1 - a,
            GateFn::Nand => 1 - (a & b),
            GateFn::Nor => 1 - (a | b),
            GateFn::Xor => a ^ b,
            GateFn::Xnor => 1 - (a ^ b),
        }
    }
}

pub struct Gate(GateFn);

impl Logic for Gate {
    fn logic(&mut self, _prev: &[u8], inp: &[u8], out: &mut [u8]) {
        out[0] = self.0.eval(inp[0], inp.get(1).copied().unwrap_or(0));
    }
    fn extra(&self, _inp: &[u8], out: &[u8], dst: &mut Extra) {
        dst.push(("out", f64::from(out[0])));
    }
}

/// A gate with `pins` pins: all inputs, then the output.
pub fn gate(f: GateFn, pins: usize) -> Digital<Gate> {
    let pins = pins.max(2);
    Digital::new((0..pins - 1).collect(), vec![pins - 1], vec![f.eval(0, 0)], Gate(f))
}

// ---------------------------------------------------------------- flip-flops and counter

pub struct DFlipFlop;

impl Logic for DFlipFlop {
    fn logic(&mut self, prev: &[u8], inp: &[u8], out: &mut [u8]) {
        if rising(prev, inp, 1) {
            out[0] = inp[0];
            out[1] = 1 - inp[0];
        }
    }
    fn extra(&self, _inp: &[u8], out: &[u8], dst: &mut Extra) {
        dst.push(("q", f64::from(out[0])));
    }
}

/// Pins: D, CLK, Q, Q̄.
pub fn d_flip_flop() -> Digital<DFlipFlop> {
    Digital::new(vec![0, 1], vec![2, 3], vec![0, 1], DFlipFlop)
}

pub struct JkFlipFlop;

impl Logic for JkFlipFlop {
    fn logic(&mut self, prev: &[u8], inp: &[u8], out: &mut [u8]) {
        if !rising(prev, inp, 1) {
            return;
        }
        let (j, k) = (inp[0], inp[2]);
        let mut q = out[0];
        if j == 1 && k == 1 {
            q = 1 - q;
        } else if j == 1 {
            q = 1;
        } else if k == 1 {
            q = 0;
        }
        out[0] = q;
        out[1] = 1 - q;
    }
    fn extra(&self, _inp: &[u8], out: &[u8], dst: &mut Extra) {
        dst.push(("q", f64::from(out[0])));
    }
}

/// Pins: J, CLK, K, Q, Q̄.
pub fn jk_flip_flop() -> Digital<JkFlipFlop> {
    Digital::new(vec![0, 1, 2], vec![3, 4], vec![0, 1], JkFlipFlop)
}

/// Decade (0–9) or binary (0–15) counter.
pub struct Counter {
    modulus: u32,
    count: u32,
}

impl Logic for Counter {
    fn configure(&mut self, p: &Params) {
        self.modulus = if p.text("mod") == "16" { 16 } else { 10 };
    }
    fn logic(&mut self, prev: &[u8], inp: &[u8], out: &mut [u8]) {
        if inp[1] == 1 {
            self.count = 0;
        } else if rising(prev, inp, 0) {
            self.count = (self.count + 1) % self.modulus;
        }
        bits4(self.count, out);
    }
    fn extra(&self, _inp: &[u8], _out: &[u8], dst: &mut Extra) {
        dst.push(("count", f64::from(self.count)));
    }
    fn save_more(&self, dst: &mut Vec<f64>) {
        dst.push(f64::from(self.count));
    }
    fn load_more(&mut self, s: &[f64]) {
        if let Some(&c) = s.first() {
            self.count = c as u32;
        }
    }
}

/// Pins: CLK, RESET, Q0..Q3.
pub fn counter() -> Digital<Counter> {
    Digital::new(vec![0, 1], vec![2, 3, 4, 5], vec![0; 4], Counter { modulus: 10, count: 0 })
}

/// Segments a..g for the digits 0–9 (bit 0 = a).
pub const SEGMENTS: [u8; 10] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

fn bcd_value(inp: &[u8]) -> u32 {
    u32::from(inp[0]) + 2 * u32::from(inp[1]) + 4 * u32::from(inp[2]) + 8 * u32::from(inp[3])
}

pub struct Bcd7;

impl Logic for Bcd7 {
    fn logic(&mut self, _prev: &[u8], inp: &[u8], out: &mut [u8]) {
        let bits = SEGMENTS.get(bcd_value(inp) as usize).copied().unwrap_or(0);
        for (i, o) in out.iter_mut().enumerate() {
            *o = (bits >> i) & 1;
        }
    }
    fn extra(&self, inp: &[u8], _out: &[u8], dst: &mut Extra) {
        dst.push(("value", f64::from(bcd_value(inp))));
    }
}

/// Pins: A, B, C, D, then segments a..g.
pub fn bcd7() -> Digital<Bcd7> {
    Digital::new(vec![0, 1, 2, 3], (4..11).collect(), vec![1, 1, 1, 1, 1, 1, 0], Bcd7)
}

// ---------------------------------------------------------------- converters

/// 4-bit A/D converter: samples VIN on each rising clock edge, or continuously if no clock arrives.
pub struct Adc {
    vref: f64,
    vin: f64,
    code: u32,
    clocked: bool,
}

impl Logic for Adc {
    fn configure(&mut self, p: &Params) {
        self.vref = p.num("Vref", 5.0).max(0.1);
    }
    fn stamp_more(&self, s: &mut Stamper, io: &Io) {
        s.g(io.nodes[0], -1, 1e-7);
    }
    fn before_accept(&mut self, c: &Ctx, io: &Io) {
        self.vin = io.v(c.x, 0);
    }
    fn accept_more(&mut self, _c: &Ctx, io: &mut Io) {
        io.cur[0] = self.vin * 1e-7;
    }
    fn logic(&mut self, prev: &[u8], inp: &[u8], out: &mut [u8]) {
        let edge = rising(prev, inp, 0);
        if edge {
            self.clocked = true;
        }
        if !self.clocked || edge {
            self.code = ((self.vin / self.vref) * 16.0).floor().clamp(0.0, 15.0) as u32;
        }
        bits4(self.code, out);
    }
    fn extra(&self, _inp: &[u8], _out: &[u8], dst: &mut Extra) {
        dst.push(("code", f64::from(self.code)));
    }
}

/// Pins: VIN, CLK, D0..D3.
pub fn adc() -> Digital<Adc> {
    Digital::new(vec![1], vec![2, 3, 4, 5], vec![0; 4], Adc { vref: 5.0, vin: 0.0, code: 0, clocked: false })
}

/// 4-bit D/A converter: VOUT = Vref × code ÷ 16, behind 10 Ω.
pub struct Dac {
    vref: f64,
    code: u32,
}

impl Dac {
    fn vout(&self) -> f64 {
        (self.vref * f64::from(self.code)) / 16.0
    }
}

impl Logic for Dac {
    fn configure(&mut self, p: &Params) {
        self.vref = p.num("Vref", 5.0).max(0.1);
    }
    fn stamp_more(&self, s: &mut Stamper, io: &Io) {
        let o = io.nodes[4];
        s.g(o, -1, 0.1);
        s.flow(-1, o, self.vout() * 0.1);
    }
    fn accept_more(&mut self, c: &Ctx, io: &mut Io) {
        io.cur[4] = (io.v(c.x, 4) - self.vout()) * 0.1;
    }
    fn ac_more(&self, s: &mut AcStamper, io: &Io) {
        s.yr(io.nodes[4], -1, 0.1);
    }
    fn logic(&mut self, _prev: &[u8], inp: &[u8], _out: &mut [u8]) {
        self.code = bcd_value(inp);
    }
    fn extra(&self, _inp: &[u8], _out: &[u8], dst: &mut Extra) {
        dst.push(("code", f64::from(self.code)));
        dst.push(("vout", self.vout()));
    }
}

/// Pins: D0..D3, VOUT.
pub fn dac() -> Digital<Dac> {
    Digital::new(vec![0, 1, 2, 3], vec![], vec![], Dac { vref: 5.0, code: 0 })
}

// ---------------------------------------------------------------- logic switch and probe

/// Logic switch: drives its pin to 0 V or 5 V.
#[derive(Debug, Default)]
pub struct LogicIn {
    out: u8,
}

impl Model for LogicIn {
    fn configure(&mut self, p: &Params) {
        self.out = u8::from(p.strict_num("state") == 1.0);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        let g = 1.0 / LOGIC_ROUT;
        s.g(io.nodes[0], -1, g);
        s.flow(-1, io.nodes[0], f64::from(self.out) * LOGIC_HIGH * g);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        io.cur[0] = (io.v(c.x, 0) - f64::from(self.out) * LOGIC_HIGH) / LOGIC_ROUT;
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], -1, 1.0 / LOGIC_ROUT);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("out", f64::from(self.out)));
    }
}

/// Logic probe: lights for a high level.
#[derive(Debug, Default)]
pub struct LogicOut {
    lvl: u8,
}

impl Model for LogicOut {
    fn configure(&mut self, _p: &Params) {}
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        s.g(io.nodes[0], -1, INPUT_G);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let v = io.v(c.x, 0);
        self.lvl = level(v, self.lvl);
        io.cur[0] = v * INPUT_G;
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], -1, INPUT_G);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("level", f64::from(self.lvl)));
    }
}
