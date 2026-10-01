//! Resistive parts: resistor, LDR, lamp, switch, fuse, potentiometer.

use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

/// Shared behaviour of two-pin parts that are a plain conductance.
#[inline]
fn stamp_g(s: &mut Stamper, io: &Io, g: f64) {
    if !io.broken {
        s.g(io.nodes[0], io.nodes[1], g);
    }
}

#[inline]
fn accept_g(c: &Ctx, io: &mut Io, g: f64) {
    let i = if io.broken { 0.0 } else { io.vd(c.x, 0, 1) * g };
    io.set2(i);
}

#[inline]
fn ac_g(s: &mut AcStamper, io: &Io, g: f64) {
    if !io.broken {
        s.yr(io.nodes[0], io.nodes[1], g);
    }
}

/// Parts that heat up: damage follows the average power (like a real filament or resistor body),
/// so an AC peak of twice the average is not mistaken for overload.
#[derive(Debug, Default, Clone, Copy)]
struct Heat {
    p_avg: f64,
    p_now: f64,
}

impl Heat {
    fn update(&mut self, c: &Ctx, io: &Io) {
        self.p_now = (io.vd(c.x, 0, 1) * io.cur[0]).abs();
        self.p_avg += (self.p_now - self.p_avg) * (c.dt / 0.05).min(1.0);
    }
    fn overloaded(&self, max: f64) -> bool {
        self.p_avg > 2.0 * max || self.p_now > 20.0 * max
    }
    fn peak(&self) -> f64 {
        self.p_avg.max(self.p_now)
    }
}

#[derive(Debug, Default)]
pub struct Resistor {
    g: f64,
    pmax: f64,
    heat: Heat,
}

impl Model for Resistor {
    fn configure(&mut self, p: &Params) {
        self.g = 1.0 / p.num("R", 1000.0).max(1e-3);
        self.pmax = p.num("Pmax", 0.25);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        stamp_g(s, io, self.g);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        accept_g(c, io, self.g);
        self.heat.update(c, io);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        ac_g(s, io, self.g);
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        self.heat.overloaded(self.pmax).then(|| Issue::burn("burn.resistor", &[("p", self.heat.peak()), ("max", self.pmax)]))
    }
    fn advice(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        (self.heat.p_avg > self.pmax).then(|| Issue::warn("warn.resistorHot", &[("p", self.heat.p_avg), ("max", self.pmax)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("heat", self.heat.p_avg / self.pmax.max(1e-9)));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.heat.p_avg]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.heat.p_avg = v;
        }
    }
}

/// Light-dependent resistor: resistance falls from `Rdark` to `Rlight` as light goes 0 → 1.
#[derive(Debug, Default)]
pub struct Ldr {
    r: f64,
}

impl Model for Ldr {
    fn configure(&mut self, p: &Params) {
        let dark = p.num("Rdark", 1e6).max(1.0);
        let lit = p.num("Rlight", 500.0).max(1.0);
        let k = p.num("light", 0.5).clamp(0.0, 1.0);
        self.r = dark * (lit / dark).powf(k);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        stamp_g(s, io, 1.0 / self.r);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        accept_g(c, io, 1.0 / self.r);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        ac_g(s, io, 1.0 / self.r);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("r", self.r));
    }
}

/// Filament lamp, modelled by its hot resistance V²/P.
#[derive(Debug, Default)]
pub struct Lamp {
    g: f64,
    v: f64,
    p: f64,
    heat: Heat,
}

impl Model for Lamp {
    fn configure(&mut self, p: &Params) {
        self.v = p.num("V", 12.0);
        self.p = p.num("P", 5.0);
        self.g = self.p.max(1e-3) / (self.v * self.v);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        stamp_g(s, io, self.g);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        accept_g(c, io, self.g);
        self.heat.update(c, io);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        ac_g(s, io, self.g);
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        self.heat.overloaded(self.p).then(|| Issue::burn("burn.lamp", &[("p", self.heat.peak()), ("max", self.p), ("v", self.v)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("brightness", self.heat.p_avg / self.p));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.heat.p_avg]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.heat.p_avg = v;
        }
    }
}

/// Toggle switch and push button: 1 mΩ closed, open circuit otherwise.
#[derive(Debug, Default)]
pub struct Switch {
    g: f64,
}

impl Model for Switch {
    fn configure(&mut self, p: &Params) {
        self.g = if p.strict_num("closed") == 1.0 { 1e3 } else { 0.0 };
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        stamp_g(s, io, self.g);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        accept_g(c, io, self.g);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        ac_g(s, io, self.g);
    }
}

#[derive(Debug, Default)]
pub struct Fuse {
    imax: f64,
}

impl Model for Fuse {
    fn configure(&mut self, p: &Params) {
        self.imax = p.num("I", 1.0);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        stamp_g(s, io, 100.0);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        accept_g(c, io, 100.0);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        ac_g(s, io, 100.0);
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0].abs();
        (i > self.imax).then(|| Issue::burn("burn.fuse", &[("i", i), ("max", self.imax)]))
    }
}

/// Potentiometer: two resistors meeting at the wiper (pins: end A, end B, wiper).
#[derive(Debug, Default)]
pub struct Pot {
    r1: f64,
    r2: f64,
}

impl Model for Pot {
    fn configure(&mut self, p: &Params) {
        let r = p.num("R", 1e4).max(1.0);
        let pos = p.num("pos", 0.5).clamp(0.0, 1.0);
        self.r1 = (r * pos).max(0.5);
        self.r2 = (r * (1.0 - pos)).max(0.5);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        s.g(io.nodes[0], io.nodes[2], 1.0 / self.r1);
        s.g(io.nodes[2], io.nodes[1], 1.0 / self.r2);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let vw = io.v(c.x, 2);
        let ia = (io.v(c.x, 0) - vw) / self.r1;
        let ib = (io.v(c.x, 1) - vw) / self.r2;
        io.cur[0] = ia;
        io.cur[1] = ib;
        io.cur[2] = -(ia + ib);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], io.nodes[2], 1.0 / self.r1);
        s.yr(io.nodes[2], io.nodes[1], 1.0 / self.r2);
    }
}
