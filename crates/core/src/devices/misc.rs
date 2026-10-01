//! Small parts: analogue switch, scope probe, and the do-nothing model for ground and labels.

use super::digital::level;
use super::{Ctx, Extra, Io, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

/// CD4053-style analogue switch: COM joins A when SEL is high, B when low; works both ways.
/// Pins: COM, A, B, SEL.
#[derive(Debug, Default)]
pub struct AnalogSwitch {
    ron: f64,
    sel: u8,
}

const OFF_G: f64 = 1e-9;

impl AnalogSwitch {
    fn g(&self) -> (f64, f64) {
        let on = 1.0 / self.ron;
        if self.sel == 1 { (on, OFF_G) } else { (OFF_G, on) }
    }
}

impl Model for AnalogSwitch {
    fn configure(&mut self, p: &Params) {
        self.ron = p.num("Ron", 50.0).max(1e-3);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        let (ga, gb) = self.g();
        s.g(io.nodes[0], io.nodes[1], ga);
        s.g(io.nodes[0], io.nodes[2], gb);
        s.g(io.nodes[3], -1, 1e-6);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let on = 1.0 / self.ron;
        let vc = io.v(c.x, 0);
        let ia = (io.v(c.x, 1) - vc) * if self.sel == 1 { on } else { OFF_G };
        let ib = (io.v(c.x, 2) - vc) * if self.sel == 1 { OFF_G } else { on };
        let vs = io.v(c.x, 3);
        io.cur.copy_from_slice(&[-(ia + ib), ia, ib, vs * 1e-6]);
        // The new position takes effect next step, like a real switch's small delay.
        self.sel = level(vs, self.sel);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        let (ga, gb) = self.g();
        s.yr(io.nodes[0], io.nodes[1], ga);
        s.yr(io.nodes[0], io.nodes[2], gb);
        s.yr(io.nodes[3], -1, 1e-6);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("sel", f64::from(self.sel)));
    }
    fn save(&self) -> Vec<f64> {
        vec![f64::from(self.sel)]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.sel = u8::from(v != 0.0);
        }
    }
}

/// Scope probe: reads the voltage of its point, draws no current.
#[derive(Debug, Default)]
pub struct Probe {
    value: f64,
}

impl Model for Probe {
    fn configure(&mut self, _p: &Params) {}
    fn stamp(&mut self, _s: &mut Stamper, _c: &Ctx, _io: &mut Io) {}
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        self.value = io.v(c.x, 0);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("v", self.value));
    }
}

/// Ground symbols, the Bode plotter and anything without electrical behaviour.
pub struct Nothing;

impl Model for Nothing {
    fn configure(&mut self, _p: &Params) {}
    fn stamp(&mut self, _s: &mut Stamper, _c: &Ctx, _io: &mut Io) {}
    fn accept(&mut self, _c: &Ctx, _io: &mut Io) {}
}
