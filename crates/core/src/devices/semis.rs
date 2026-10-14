//! Three-terminal semiconductors: SCR and triac, bipolar transistors, MOSFETs.

use super::junction::{GMIN, Junction, VT, pnjlim, safe_exp, step_limit, vcrit};
use super::{Ctx, Extra, Io, Issue, Model, volt};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

/// SCR and triac (pins: anode/MT2, cathode/MT1, gate). The gate is a junction to the cathode;
/// the main path is either blocking (tiny leakage) or conducting like a diode (two opposed
/// diodes for the triac). It latches on when gate current exceeds Igt and switches off below
/// the holding current.
#[derive(Debug)]
pub struct Thyristor {
    bidirectional: bool,
    igt: f64,
    ih: f64,
    on: bool,
    gate_f: Junction,
    gate_r: Junction,
    main_f: Junction,
    main_r: Junction,
}

impl Thyristor {
    pub fn new(bidirectional: bool) -> Self {
        Self {
            bidirectional,
            igt: 0.001,
            ih: 0.005,
            on: false,
            gate_f: Junction::new(1e-14, VT),
            gate_r: Junction::new(1e-14, VT),
            main_f: Junction::new(1e-10, 1.6 * VT),
            main_r: Junction::new(1e-10, 1.6 * VT),
        }
    }
}

impl Model for Thyristor {
    fn configure(&mut self, p: &Params) {
        self.igt = p.num("Igt", 0.001);
        self.ih = p.num("Ih", 0.005);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let (a, k, g) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        let vak = io.vd(c.x, 0, 1);
        let vgk = io.vd(c.x, 2, 1);
        let mut lim = self.gate_f.stamp(s, g, k, vgk);
        if self.bidirectional {
            lim = self.gate_r.stamp(s, k, g, -vgk) || lim;
        }
        if self.on {
            lim = self.main_f.stamp(s, a, k, vak) || lim;
            if self.bidirectional {
                lim = self.main_r.stamp(s, k, a, -vak) || lim;
            }
        } else {
            s.g(a, k, 1e-7);
        }
        io.limited = lim;
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let vak = io.vd(c.x, 0, 1);
        let vgk = io.vd(c.x, 2, 1);
        let bi = self.bidirectional;
        let ig = self.gate_f.current(vgk) - if bi { self.gate_r.current(-vgk) } else { 0.0 };
        let iak = if self.on { self.main_f.current(vak) - if bi { self.main_r.current(-vak) } else { 0.0 } } else { vak * 1e-7 };
        io.cur[0] = iak;
        io.cur[1] = -(iak + ig);
        io.cur[2] = ig;
        if !self.on {
            let fires = if bi { ig.abs() > self.igt && vak.abs() > 0.3 } else { ig > self.igt && vak > 0.3 };
            if fires {
                self.on = true;
            }
        } else if (if bi { iak.abs() } else { iak }) < self.ih {
            self.on = false;
        }
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        let (a, k, g) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        s.yr(g, k, self.gate_f.g());
        s.yr(a, k, if self.on { self.main_f.g() } else { 1e-7 });
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0].abs();
        (i > 25.0).then(|| Issue::burn("burn.thyristor", &[("i", i)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("on", f64::from(self.on)));
    }
    fn save(&self) -> Vec<f64> {
        vec![f64::from(self.on)]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.on = v != 0.0;
        }
    }
}

/// DIAC: blocks in both directions until the voltage reaches the breakover voltage (about 32 V),
/// then conducts like a diode in that direction until the current falls below the holding current.
/// Used to fire a triac from an RC phase-shift network.
#[derive(Debug)]
pub struct Diac {
    vbo: f64,
    ih: f64,
    on: bool,
    fwd: Junction,
    rev: Junction,
}

impl Default for Diac {
    fn default() -> Self {
        Self { vbo: 32.0, ih: 0.002, on: false, fwd: Junction::new(1e-10, 1.6 * VT), rev: Junction::new(1e-10, 1.6 * VT) }
    }
}

impl Model for Diac {
    fn configure(&mut self, p: &Params) {
        self.vbo = p.num("Vbo", 32.0).max(1.0);
        self.ih = p.num("Ih", 0.002).max(1e-6);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let (a, b) = (io.nodes[0], io.nodes[1]);
        let v = io.vd(c.x, 0, 1);
        if self.on {
            let lim = self.fwd.stamp(s, a, b, v);
            io.limited = self.rev.stamp(s, b, a, -v) || lim;
        } else {
            s.g(a, b, 1e-7);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let v = io.vd(c.x, 0, 1);
        let i = if self.on { self.fwd.current(v) - self.rev.current(-v) } else { v * 1e-7 };
        io.set2(i);
        if !self.on && v.abs() >= self.vbo {
            self.on = true;
        } else if self.on && i.abs() < self.ih {
            self.on = false;
        }
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], io.nodes[1], if self.on { self.fwd.g() } else { 1e-7 });
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0].abs();
        (i > 2.0).then(|| Issue::burn("burn.thyristor", &[("i", i)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("on", f64::from(self.on)));
    }
    fn save(&self) -> Vec<f64> {
        vec![f64::from(self.on)]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.on = v != 0.0;
        }
    }
}

/// Ebers–Moll bipolar transistor with the Early effect. Pins: base, collector, emitter.
#[derive(Debug)]
pub struct Bjt {
    /// +1 for NPN, −1 for PNP.
    pol: f64,
    beta: f64,
    va: f64,
    pmax: f64,
    vbe: f64,
    vbc: f64,
}

const BJT_IS: f64 = 1e-14;
const BJT_BETA_R: f64 = 1.0;

/// Terminal currents and their derivatives with respect to (vbe, vbc).
struct BjtEval {
    ic: f64,
    ib: f64,
    dic: [f64; 2],
    dib: [f64; 2],
}

impl Bjt {
    pub fn new(pol: f64) -> Self {
        Self { pol, beta: 100.0, va: 100.0, pmax: 0.5, vbe: 0.0, vbc: 0.0 }
    }

    fn eval(&self, vbe: f64, vbc: f64) -> BjtEval {
        let bf = self.beta;
        let ef = safe_exp(vbe / VT);
        let er = safe_exp(vbc / VT);
        let i_f = BJT_IS * (ef - 1.0);
        let i_r = BJT_IS * (er - 1.0);
        let gf = (BJT_IS * ef) / VT + GMIN;
        let gr = (BJT_IS * er) / VT + GMIN;
        // Early effect: the collector current rises slowly with Vce (base-width modulation).
        let q = (1.0 - vbc / self.va).max(0.1);
        let dq = if q > 0.1 { -1.0 / self.va } else { 0.0 };
        let it = i_f - i_r;
        BjtEval {
            ic: it * q - i_r / BJT_BETA_R,
            ib: i_f / bf + i_r / BJT_BETA_R,
            dic: [gf * q, -gr * q + it * dq - gr / BJT_BETA_R],
            dib: [gf / bf, gr / BJT_BETA_R],
        }
    }
}

impl Model for Bjt {
    fn configure(&mut self, p: &Params) {
        self.beta = p.num("beta", 100.0).max(1.0);
        self.va = p.num("VA", 100.0).max(1.0);
        self.pmax = p.num("Pmax", 0.5);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let p = self.pol;
        let (b, col, e) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        let vb = volt(c.x, b);
        let raw_be = p * (vb - volt(c.x, e));
        let raw_bc = p * (vb - volt(c.x, col));
        let vc = vcrit(BJT_IS, VT);
        let vbe = pnjlim(raw_be, self.vbe, VT, vc);
        let vbc = pnjlim(raw_bc, self.vbc, VT, vc);
        io.limited = (vbe - raw_be).abs() + (vbc - raw_bc).abs() > 1e-9;
        self.vbe = vbe;
        self.vbc = vbc;
        let m = self.eval(vbe, vbc);
        let die = [-(m.dic[0] + m.dib[0]), -(m.dic[1] + m.dib[1])];
        // Terminal order C, B, E. Actual current = p·f(p·ΔV), so derivatives keep their sign.
        s.lin([col, b, e], [p * m.ic, p * m.ib, -p * (m.ic + m.ib)], [(b, e, p * vbe), (b, col, p * vbc)], [m.dic, m.dib, die]);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let p = self.pol;
        let vb = io.v(c.x, 0);
        self.vbe = p * (vb - io.v(c.x, 2));
        self.vbc = p * (vb - io.v(c.x, 1));
        let m = self.eval(self.vbe, self.vbc);
        io.cur[0] = p * m.ib;
        io.cur[1] = p * m.ic;
        io.cur[2] = -p * (m.ib + m.ic);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if io.broken {
            return;
        }
        let (b, col, e) = (io.nodes[0], io.nodes[1], io.nodes[2]);
        let m = self.eval(self.vbe, self.vbc);
        let die = [-(m.dic[0] + m.dib[0]), -(m.dic[1] + m.dib[1])];
        for (row, d) in [(col, m.dic), (b, m.dib), (e, die)] {
            s.trans(row, b, e, d[0], 0.0);
            s.trans(row, b, col, d[1], 0.0);
        }
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let ib = io.cur[0].abs();
        if ib > 0.1 {
            return Some(Issue::burn("burn.base", &[("i", ib)]));
        }
        let vce = self.vbe - self.vbc;
        let pw = (io.cur[1] * vce).abs() + (io.cur[0] * self.vbe).abs();
        (pw > 2.0 * self.pmax).then(|| Issue::burn("burn.transistor", &[("p", pw), ("max", self.pmax)]))
    }
    fn extra(&self, _c: &Ctx, io: &Io, out: &mut Extra) {
        out.push(("vbe", self.pol * self.vbe));
        out.push(("vce", self.pol * (self.vbe - self.vbc)));
        out.push(("ib", io.cur[0]));
        out.push(("ic", io.cur[1]));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.vbe, self.vbc]
    }
    fn load(&mut self, s: &[f64]) {
        if s.len() >= 2 {
            self.vbe = s[0];
            self.vbc = s[1];
        }
    }
}

/// Square-law MOSFET with channel-length modulation. Pins: gate, drain, source.
#[derive(Debug)]
pub struct Mosfet {
    pol: f64,
    k: f64,
    vth: f64,
    vgs: f64,
    vds: f64,
}

const LAMBDA: f64 = 0.02;

/// Drain current and its derivatives.
#[derive(Clone, Copy)]
struct FetEval {
    id: f64,
    gm: f64,
    gds: f64,
}

/// Drain and source as seen by the model: swapped when vds < 0, since the device is symmetric.
struct Oriented {
    d: i32,
    s: i32,
    vgs: f64,
    vds: f64,
}

impl Mosfet {
    pub fn new(pol: f64) -> Self {
        Self { pol, k: 0.1, vth: 2.0, vgs: 0.0, vds: 0.0 }
    }

    /// For vds ≥ 0 (n-channel sense).
    fn eval(&self, vgs: f64, vds: f64) -> FetEval {
        let k = self.k;
        let vov = vgs - self.vth;
        if vov <= 0.0 {
            return FetEval { id: 0.0, gm: 0.0, gds: GMIN };
        }
        if vds < vov {
            let base = vov * vds - (vds * vds) / 2.0;
            return FetEval {
                id: k * base * (1.0 + LAMBDA * vds),
                gm: k * vds * (1.0 + LAMBDA * vds),
                gds: k * (vov - vds) * (1.0 + LAMBDA * vds) + k * base * LAMBDA + GMIN,
            };
        }
        FetEval { id: (k / 2.0) * vov * vov * (1.0 + LAMBDA * vds), gm: k * vov * (1.0 + LAMBDA * vds), gds: (k / 2.0) * vov * vov * LAMBDA + GMIN }
    }

    fn oriented(&self, io: &Io) -> Oriented {
        let (d, s) = (io.nodes[1], io.nodes[2]);
        let rev = self.vds < 0.0;
        Oriented { d: if rev { s } else { d }, s: if rev { d } else { s }, vgs: if rev { self.vgs - self.vds } else { self.vgs }, vds: self.vds.abs() }
    }
}

impl Model for Mosfet {
    fn configure(&mut self, p: &Params) {
        self.k = p.num("K", 0.1).max(1e-9);
        self.vth = p.num("Vth", 2.0).max(0.01);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let p = self.pol;
        let g = io.nodes[0];
        let (vg, vd, vs) = (io.v(c.x, 0), io.v(c.x, 1), io.v(c.x, 2));
        let raw_gs = p * (vg - vs);
        let raw_ds = p * (vd - vs);
        self.vgs = step_limit(raw_gs, self.vgs, 1.0);
        self.vds = step_limit(raw_ds, self.vds, 2.0);
        io.limited = (self.vgs - raw_gs).abs() + (self.vds - raw_ds).abs() > 1e-9;
        let o = self.oriented(io);
        let m = self.eval(o.vgs, o.vds);
        s.lin([o.d, o.s], [p * m.id, -p * m.id], [(g, o.s, p * o.vgs), (o.d, o.s, p * o.vds)], [[m.gm, m.gds], [-m.gm, -m.gds]]);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let p = self.pol;
        let vs = io.v(c.x, 2);
        self.vgs = p * (io.v(c.x, 0) - vs);
        self.vds = p * (io.v(c.x, 1) - vs);
        let rev = self.vds < 0.0;
        let m = self.eval(if rev { self.vgs - self.vds } else { self.vgs }, self.vds.abs());
        let id = p * if rev { -m.id } else { m.id };
        io.cur[0] = 0.0;
        io.cur[1] = id;
        io.cur[2] = -id;
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if io.broken {
            return;
        }
        let g = io.nodes[0];
        let o = self.oriented(io);
        let m = self.eval(o.vgs, o.vds);
        s.trans(o.d, g, o.s, m.gm, 0.0);
        s.trans(o.d, o.d, o.s, m.gds, 0.0);
        s.trans(o.s, g, o.s, -m.gm, 0.0);
        s.trans(o.s, o.d, o.s, -m.gds, 0.0);
    }
    fn extra(&self, _c: &Ctx, io: &Io, out: &mut Extra) {
        out.push(("vgs", self.pol * self.vgs));
        out.push(("vds", self.pol * self.vds));
        out.push(("id", io.cur[1]));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.vgs, self.vds]
    }
    fn load(&mut self, s: &[f64]) {
        if s.len() >= 2 {
            self.vgs = s[0];
            self.vds = s[1];
        }
    }
}
