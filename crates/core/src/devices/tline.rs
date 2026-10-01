//! Lossless (or lightly lossy) transmission line by the method of characteristics:
//! each end looks like Z0 in series with the wave that left the other end Td seconds ago.
//! Pins: input +, input −, output +, output −.

use super::{Ctx, Io, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};
use std::collections::VecDeque;

#[derive(Debug, Default)]
pub struct TLine {
    z0: f64,
    td_param: f64,
    k: f64,
    /// Times and port values [v1, i1, v2, i2] of past steps, oldest first.
    ts: VecDeque<f64>,
    hist: VecDeque<[f64; 4]>,
    /// The incoming waves at each end for the step being solved.
    e: [f64; 2],
}

impl TLine {
    fn td(&self, dt: f64) -> f64 {
        self.td_param.max(dt)
    }

    /// Port voltages and currents at time t (zero before the line was energised).
    fn past(&self, t: f64) -> [f64; 4] {
        let ts = &self.ts;
        if ts.is_empty() || t < ts[0] {
            return [0.0; 4];
        }
        let mut lo = 0;
        let mut hi = ts.len() - 1;
        if t >= ts[hi] {
            return self.hist[hi];
        }
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1;
            if ts[mid] <= t {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let span = ts[hi] - ts[lo];
        let f = (t - ts[lo]) / if span != 0.0 { span } else { 1.0 };
        let (a, b) = (self.hist[lo], self.hist[hi]);
        std::array::from_fn(|i| a[i] + f * (b[i] - a[i]))
    }

    fn waves(&self, t: f64, dt: f64) -> [f64; 2] {
        let [v1, i1, v2, i2] = self.past(t - self.td(dt));
        [self.k * (v2 + self.z0 * i2), self.k * (v1 + self.z0 * i1)]
    }
}

impl Model for TLine {
    fn configure(&mut self, p: &Params) {
        self.z0 = p.num("Z0", 75.0).max(1e-3);
        self.td_param = p.num("Td", 100e-6);
        self.k = 10f64.powf(-p.num("loss", 0.0).max(0.0) / 20.0);
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let g = 1.0 / self.z0;
        let [a1, a2, b1, b2] = [io.nodes[0], io.nodes[1], io.nodes[2], io.nodes[3]];
        self.e = self.waves(c.t, c.dt);
        s.g(a1, a2, g);
        s.flow(a1, a2, -g * self.e[0]);
        s.g(b1, b2, g);
        s.flow(b1, b2, -g * self.e[1]);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let v1 = io.vd(c.x, 0, 1);
        let v2 = io.vd(c.x, 2, 3);
        let i1 = (v1 - self.e[0]) / self.z0;
        let i2 = (v2 - self.e[1]) / self.z0;
        io.cur.copy_from_slice(&[i1, -i1, i2, -i2]);
        self.ts.push_back(c.t);
        self.hist.push_back([v1, i1, v2, i2]);
        // Forget what is older than the delay needs, in batches.
        let td = self.td(c.dt);
        let mut drop = 0;
        while drop + 2 < self.ts.len() && self.ts[drop + 1] < c.t - td * 1.5 {
            drop += 1;
        }
        if drop > 256 {
            self.ts.drain(..drop);
            self.hist.drain(..drop);
        }
    }
    fn ac(&self, s: &mut AcStamper, w: f64, io: &Io) {
        let td = self.td(1e-9);
        let alpha = (-self.k.ln()).max(1e-6);
        let th = w * td;
        // sinh and cosh of γl = α + jθ
        let sh = [alpha.sinh() * th.cos(), alpha.cosh() * th.sin()];
        let ch = [alpha.cosh() * th.cos(), alpha.sinh() * th.sin()];
        let den = sh[0] * sh[0] + sh[1] * sh[1];
        let coth = [(ch[0] * sh[0] + ch[1] * sh[1]) / den, (ch[1] * sh[0] - ch[0] * sh[1]) / den];
        let csch = [sh[0] / den, -sh[1] / den];
        let z0 = self.z0;
        let y11 = [coth[0] / z0, coth[1] / z0];
        let y12 = [-csch[0] / z0, -csch[1] / z0];
        let ports = [(io.nodes[0], io.nodes[1]), (io.nodes[2], io.nodes[3])];
        for (i, &(p, n)) in ports.iter().enumerate() {
            for (j, &(q, m)) in ports.iter().enumerate() {
                let y = if i == j { y11 } else { y12 };
                s.trans(p, q, m, y[0], y[1]);
                s.trans(n, q, m, -y[0], -y[1]);
            }
        }
    }
}
