//! Op-amp with its supply built in: very high gain with one pole (gain-bandwidth product),
//! output that saturates smoothly at ±Vsat, 2 MΩ input and 75 Ω output resistance.
//! Pins: inverting input (−), non-inverting input (+), output.

use super::junction::step_limit;
use super::{Ctx, Extra, Io, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};
use std::f64::consts::PI;

const ROUT: f64 = 75.0;
const RIN: f64 = 2e6;

#[derive(Debug, Default)]
pub struct OpAmp {
    a: f64,
    vsat: f64,
    tau: f64,
    vos: f64,
    /// Internal gain-stage voltage, the part's memory between steps.
    vint: f64,
    vd_last: f64,
}

struct Core {
    vi: f64,
    out: f64,
    dout: f64,
}

impl OpAmp {
    fn core(&self, vd: f64, dt: f64) -> Core {
        let k = dt / self.tau;
        // A real 741 has about 1 mV input offset; it is also what starts an oscillator.
        let vi = (self.vint + k * self.a * (vd + self.vos)) / (1.0 + k);
        let th = (vi / self.vsat).tanh();
        Core { vi, out: self.vsat * th, dout: (1.0 - th * th) * ((k * self.a) / (1.0 + k)) }
    }
}

impl Model for OpAmp {
    fn configure(&mut self, p: &Params) {
        self.a = p.num("A", 1e5).max(10.0);
        self.vsat = p.num("Vsat", 13.0).max(0.5);
        self.tau = self.a / (2.0 * PI * p.num("GBW", 1e6).max(1.0));
        self.vos = p.num("Vos", 0.001);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let (nm, np, out) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        s.g(np, nm, 1.0 / RIN);
        let raw = io.vd(c.x, 1, 0);
        let vd = step_limit(raw, self.vd_last, 0.5);
        io.limited = (vd - raw).abs() > 1e-12;
        self.vd_last = vd;
        let m = self.core(vd, c.dt);
        let vo = io.v(c.x, 2);
        let g = 1.0 / ROUT;
        s.lin([out], [(vo - m.out) * g], [(out, -1, vo), (np, nm, vd)], [[g, -m.dout * g]]);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let vd = io.vd(c.x, 1, 0);
        self.vd_last = vd;
        let m = self.core(vd, c.dt);
        // Keep the internal stage from winding up far past saturation.
        self.vint = m.vi.clamp(-4.0 * self.vsat, 4.0 * self.vsat);
        let iin = vd / RIN;
        io.cur[0] = -iin;
        io.cur[1] = iin;
        io.cur[2] = (io.v(c.x, 2) - m.out) / ROUT;
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        let (nm, np, out) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        let th = (self.vint / self.vsat).tanh();
        let a = self.a * (1.0 - th * th);
        let den = 1.0 + w * w * self.tau * self.tau;
        let g = 1.0 / ROUT;
        s.yr(np, nm, 1.0 / RIN);
        s.yr(out, -1, g);
        // A(jω) = a / (1 + jωτ)
        s.trans(out, np, nm, (-g * a) / den, (g * a * w * self.tau) / den);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("vd", self.vd_last));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.vint]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.vint = v;
        }
    }
}
