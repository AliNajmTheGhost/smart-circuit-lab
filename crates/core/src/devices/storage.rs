//! Energy-storage parts: capacitor, inductor, transformer.
//!
//! All three are integrated with BDF2 (second-order backward difference) after the first step.
//! Unlike backward Euler it does not drain energy from LC circuits, so oscillators keep ringing,
//! and unlike the trapezoidal rule it does not ring numerically when a switch closes.

use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

#[derive(Debug)]
pub struct Capacitor {
    polarized: bool,
    c: f64,
    vmax: f64,
    v_prev: f64,
    v_prev2: f64,
    hist: u64,
}

impl Capacitor {
    pub fn new(polarized: bool) -> Self {
        Self { polarized, c: 1e-6, vmax: 50.0, v_prev: 0.0, v_prev2: 0.0, hist: 0 }
    }

    /// Companion model for this step: `i = g·v + ieq`.
    #[inline]
    fn coef(&self, dt: f64) -> (f64, f64) {
        let k = self.c / dt;
        if self.hist >= 1 { (1.5 * k, k * (-2.0 * self.v_prev + 0.5 * self.v_prev2)) } else { (k, -k * self.v_prev) }
    }
}

impl Model for Capacitor {
    fn configure(&mut self, p: &Params) {
        self.c = p.num("C", 1e-6).max(1e-15);
        self.vmax = p.num("Vmax", 50.0);
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let (g, ieq) = self.coef(c.dt);
        s.g(io.nodes[0], io.nodes[1], g);
        s.flow(io.nodes[0], io.nodes[1], ieq);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let v = io.vd(c.x, 0, 1);
        let (g, ieq) = self.coef(c.dt);
        let i = g * v + ieq;
        self.v_prev2 = self.v_prev;
        self.v_prev = v;
        self.hist += 1;
        io.set2(i);
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        if !io.broken {
            s.y(io.nodes[0], io.nodes[1], 0.0, w * self.c);
        }
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        if self.polarized && self.v_prev < -1.5 {
            return Some(Issue::burn("burn.ecapReverse", &[("v", -self.v_prev)]));
        }
        let v = self.v_prev.abs();
        (v > 1.2 * self.vmax).then(|| Issue::burn("burn.capVoltage", &[("v", v), ("max", self.vmax)]))
    }
    fn save(&self) -> Vec<f64> {
        vec![self.v_prev, self.v_prev2, self.hist as f64]
    }
    /// After a rebuild the time step may be different, so the two-step history no longer lines up:
    /// keep the charge and restart with one backward-Euler step.
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.v_prev = if v.is_nan() { 0.0 } else { v };
        }
        self.v_prev2 = self.v_prev;
        self.hist = 0;
    }
}

/// Coil with its wire resistance.
#[derive(Debug, Default)]
pub struct Inductor {
    l: f64,
    r: f64,
    i_prev: f64,
    i_prev2: f64,
    hist: u64,
}

impl Inductor {
    /// Companion model for this step: `i = g·v + k`.
    #[inline]
    fn coef(&self, dt: f64) -> (f64, f64) {
        let l = self.l / dt;
        if self.hist >= 1 {
            let g = 1.0 / (self.r + 1.5 * l);
            (g, g * l * (2.0 * self.i_prev - 0.5 * self.i_prev2))
        } else {
            let g = 1.0 / (self.r + l);
            (g, g * l * self.i_prev)
        }
    }
}

impl Model for Inductor {
    fn configure(&mut self, p: &Params) {
        self.l = p.num("L", 0.01).max(1e-12);
        self.r = p.num("Rs", 1.0).max(1e-6);
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let (g, k) = self.coef(c.dt);
        s.g(io.nodes[0], io.nodes[1], g);
        s.flow(io.nodes[0], io.nodes[1], k);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let (g, k) = self.coef(c.dt);
        let i = g * io.vd(c.x, 0, 1) + k;
        self.i_prev2 = self.i_prev;
        self.i_prev = i;
        self.hist += 1;
        io.set2(i);
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        let den = self.r * self.r + w * w * self.l * self.l;
        s.y(io.nodes[0], io.nodes[1], self.r / den, (-w * self.l) / den);
    }
    fn save(&self) -> Vec<f64> {
        vec![self.i_prev, self.i_prev2, self.hist as f64]
    }
    /// Same as the capacitor: keep the current, restart the two-step history.
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.i_prev = if v.is_nan() { 0.0 } else { v };
        }
        self.i_prev2 = self.i_prev;
        self.hist = 0;
    }
}

/// Two coupled coils (k = 0.999). Pins: primary +, primary −, secondary +, secondary −.
#[derive(Debug, Default)]
pub struct Transformer {
    /// Inverse inductance matrix [[a, b], [b, d]].
    a: f64,
    b: f64,
    d: f64,
    i1: f64,
    i2: f64,
    h1: f64,
    h2: f64,
    hist: u64,
}

impl Transformer {
    /// Scale of the coil admittance and the history currents for this step (BDF2 after the first).
    #[inline]
    fn step(&self, dt: f64) -> (f64, f64, f64) {
        if self.hist >= 1 {
            (dt / 1.5, (2.0 * self.i1 - 0.5 * self.h1) / 1.5, (2.0 * self.i2 - 0.5 * self.h2) / 1.5)
        } else {
            (dt, self.i1, self.i2)
        }
    }
}

impl Model for Transformer {
    fn configure(&mut self, p: &Params) {
        let n = p.num("n", 10.0).max(0.01);
        let l1 = p.num("L1", 10.0).max(1e-9);
        let l2 = l1 / (n * n);
        let m = 0.999 * (l1 * l2).sqrt();
        let det = l1 * l2 - m * m;
        self.a = l2 / det;
        self.b = -m / det;
        self.d = l1 / det;
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let (a, b, d) = (self.a, self.b, self.d);
        let (dt, j1, j2) = self.step(c.dt);
        let [p1, p2, s1, s2] = [io.nodes[0], io.nodes[1], io.nodes[2], io.nodes[3]];
        let v1 = io.vd(c.x, 0, 1);
        let v2 = io.vd(c.x, 2, 3);
        let i1 = dt * (a * v1 + b * v2) + j1;
        let i2 = dt * (b * v1 + d * v2) + j2;
        s.lin(
            [p1, p2, s1, s2],
            [i1, -i1, i2, -i2],
            [(p1, p2, v1), (s1, s2, v2)],
            [[dt * a, dt * b], [-dt * a, -dt * b], [dt * b, dt * d], [-dt * b, -dt * d]],
        );
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let (dt, j1, j2) = self.step(c.dt);
        let v1 = io.vd(c.x, 0, 1);
        let v2 = io.vd(c.x, 2, 3);
        let n1 = dt * (self.a * v1 + self.b * v2) + j1;
        let n2 = dt * (self.b * v1 + self.d * v2) + j2;
        self.h1 = self.i1;
        self.h2 = self.i2;
        self.i1 = n1;
        self.i2 = n2;
        self.hist += 1;
        io.cur.copy_from_slice(&[n1, -n1, n2, -n2]);
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        let (a, b, d) = (self.a, self.b, self.d);
        let [p1, p2, s1, s2] = [io.nodes[0], io.nodes[1], io.nodes[2], io.nodes[3]];
        // Y = Γ / (jω) = −j·Γ/ω
        let k = -1.0 / w;
        s.trans(p1, p1, p2, 0.0, k * a);
        s.trans(p1, s1, s2, 0.0, k * b);
        s.trans(p2, p1, p2, 0.0, -k * a);
        s.trans(p2, s1, s2, 0.0, -k * b);
        s.trans(s1, p1, p2, 0.0, k * b);
        s.trans(s1, s1, s2, 0.0, k * d);
        s.trans(s2, p1, p2, 0.0, -k * b);
        s.trans(s2, s1, s2, 0.0, -k * d);
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        let i = self.i1.abs();
        (i > 20.0).then(|| Issue::burn("burn.transformer", &[("i", i)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("i1", self.i1));
        out.push(("i2", self.i2));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.i1, self.i2, self.h1, self.h2, self.hist as f64]
    }
    /// Keep the winding currents; the two-step history restarts because the time step may differ.
    fn load(&mut self, s: &[f64]) {
        if s.len() < 2 {
            return;
        }
        self.i1 = s[0];
        self.i2 = s[1];
        self.h1 = self.i1;
        self.h2 = self.i2;
        self.hist = 0;
    }
}

/// Transformer with a centre-tapped secondary: one primary and two equal secondary halves, all
/// coupled (k = 0.9999, so little leakage even at audio frequencies). Pins: primary +, primary −, secondary top, centre tap, secondary bottom.
/// Used in push-pull amplifiers and full-wave rectifiers with two diodes.
#[derive(Debug, Default)]
pub struct CenterTap {
    /// Inverse inductance matrix of the three windings.
    g: [[f64; 3]; 3],
    i: [f64; 3],
    h: [f64; 3],
    hist: u64,
}

impl CenterTap {
    /// Winding voltages: primary, top half (top − tap), bottom half (tap − bottom).
    #[inline]
    fn volts(x: &[f64], io: &Io) -> [f64; 3] {
        [io.vd(x, 0, 1), io.vd(x, 2, 3), io.vd(x, 3, 4)]
    }

    /// Admittance scale and history currents for this step (BDF2 after the first).
    #[inline]
    fn step(&self, dt: f64) -> (f64, [f64; 3]) {
        if self.hist >= 1 {
            (dt / 1.5, std::array::from_fn(|k| (2.0 * self.i[k] - 0.5 * self.h[k]) / 1.5))
        } else {
            (dt, self.i)
        }
    }

    fn currents(&self, dt: f64, v: [f64; 3]) -> [f64; 3] {
        let (c, j) = self.step(dt);
        std::array::from_fn(|k| c * (self.g[k][0] * v[0] + self.g[k][1] * v[1] + self.g[k][2] * v[2]) + j[k])
    }
}

/// Inverse of a symmetric 3×3 matrix.
fn inverse3(m: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let c = |r0: usize, r1: usize, c0: usize, c1: usize| m[r0][c0] * m[r1][c1] - m[r0][c1] * m[r1][c0];
    let a = [[c(1, 2, 1, 2), -c(0, 2, 1, 2), c(0, 1, 1, 2)], [-c(1, 2, 0, 2), c(0, 2, 0, 2), -c(0, 1, 0, 2)], [c(1, 2, 0, 1), -c(0, 2, 0, 1), c(0, 1, 0, 1)]];
    let det = m[0][0] * a[0][0] + m[0][1] * a[1][0] + m[0][2] * a[2][0];
    std::array::from_fn(|r| std::array::from_fn(|k| a[r][k] / det))
}

impl Model for CenterTap {
    fn configure(&mut self, p: &Params) {
        // n = N1 : N2 over the whole secondary, so each half has half the turns.
        let n = p.num("n", 10.0).max(0.01);
        let l1 = p.num("L1", 1.0).max(1e-9);
        let lh = l1 / (4.0 * n * n);
        let l = [l1, lh, lh];
        let m: [[f64; 3]; 3] = std::array::from_fn(|r| std::array::from_fn(|k| if r == k { l[r] } else { 0.9999 * (l[r] * l[k]).sqrt() }));
        self.g = inverse3(m);
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let v = Self::volts(c.x, io);
        let i = self.currents(c.dt, v);
        let (k, _) = self.step(c.dt);
        let g = self.g;
        let [p1, p2, top, tap, bot] = [io.nodes[0], io.nodes[1], io.nodes[2], io.nodes[3], io.nodes[4]];
        let row = |w: usize| [k * g[w][0], k * g[w][1], k * g[w][2]];
        let neg = |r: [f64; 3]| [-r[0], -r[1], -r[2]];
        s.lin(
            [p1, p2, top, tap, tap, bot],
            [i[0], -i[0], i[1], -i[1], i[2], -i[2]],
            [(p1, p2, v[0]), (top, tap, v[1]), (tap, bot, v[2])],
            [row(0), neg(row(0)), row(1), neg(row(1)), row(2), neg(row(2))],
        );
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let v = Self::volts(c.x, io);
        let n = self.currents(c.dt, v);
        self.h = self.i;
        self.i = n;
        self.hist += 1;
        io.cur.copy_from_slice(&[n[0], -n[0], n[1], n[2] - n[1], -n[2]]);
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        let [p1, p2, top, tap, bot] = [io.nodes[0], io.nodes[1], io.nodes[2], io.nodes[3], io.nodes[4]];
        let wind = [(p1, p2), (top, tap), (tap, bot)];
        // Y = Γ / (jω) = −j·Γ/ω
        let k = -1.0 / w;
        for (r, &(ra, rb)) in wind.iter().enumerate() {
            for (cc, &(ca, cb)) in wind.iter().enumerate() {
                let y = k * self.g[r][cc];
                s.trans(ra, ca, cb, 0.0, y);
                s.trans(rb, ca, cb, 0.0, -y);
            }
        }
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        let i = self.i[0].abs();
        (i > 20.0).then(|| Issue::burn("burn.transformer", &[("i", i)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("i1", self.i[0]));
        out.push(("i2a", self.i[1]));
        out.push(("i2b", self.i[2]));
    }
    fn save(&self) -> Vec<f64> {
        self.i.to_vec()
    }
    fn load(&mut self, s: &[f64]) {
        if s.len() < 3 {
            return;
        }
        self.i = [s[0], s[1], s[2]];
        self.h = self.i;
        self.hist = 0;
    }
}
