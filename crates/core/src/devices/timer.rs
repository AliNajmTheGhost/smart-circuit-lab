//! Behavioural NE555: two comparators, an SR flip-flop, a discharge switch and an output stage.

use super::{Ctx, Extra, Io, Model};
use crate::doc::Params;
use crate::stamp::{AcStamper, Stamper};

/// Pin order: VCC, RESET, DIS, THR, TRIG, GND, OUT, CTRL.
#[derive(Debug, Default)]
pub struct Timer555 {
    q: bool,
}

const R_OUT: f64 = 10.0;
const R_DIS: f64 = 20.0;
/// Output high sits this far below VCC, as on the bipolar 555.
const V_DROP: f64 = 1.5;

impl Model for Timer555 {
    fn configure(&mut self, _p: &Params) {}
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        let n = &io.nodes;
        let [vcc, rst, dis, thr, trig, gnd, out, ctrl] = [n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7]];
        s.g(vcc, ctrl, 1.0 / 5000.0);
        s.g(ctrl, gnd, 1.0 / 10000.0);
        s.g(vcc, rst, 1.0 / 20000.0);
        s.g(thr, gnd, 1e-7);
        s.g(trig, gnd, 1e-7);
        let g = 1.0 / R_OUT;
        if self.q {
            s.g(out, vcc, g);
            s.flow(out, vcc, V_DROP * g);
            s.g(dis, gnd, 1e-9);
        } else {
            s.g(out, gnd, g);
            s.g(dis, gnd, 1.0 / R_DIS);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let x = c.x;
        let vg = io.v(x, 5);
        let rel = |i: usize| io.v(x, i) - vg;
        let vcc = rel(0);
        let ctrl = rel(7);
        let i_out = if self.q { (io.v(x, 6) - io.v(x, 0) + V_DROP) / R_OUT } else { (io.v(x, 6) - vg) / R_OUT };
        let i_dis = if self.q { 0.0 } else { rel(2) / R_DIS };
        let i_div = (vcc - ctrl) / 5000.0;
        let i_rst = (vcc - rel(1)) / 20000.0;
        let (trig, thr, reset) = (rel(4), rel(3), rel(1));
        let cur = [
            i_div + i_rst - if self.q { i_out } else { 0.0 },
            -i_rst,
            i_dis,
            thr * 1e-7,
            trig * 1e-7,
            0.0,
            i_out,
            -i_div + ctrl / 10000.0,
        ];
        io.cur[..8].copy_from_slice(&cur);
        io.cur[5] = -cur.iter().sum::<f64>();
        if vcc < 3.0 || reset < 0.7 {
            self.q = false;
        } else if trig < ctrl / 2.0 {
            self.q = true;
        } else if thr > ctrl {
            self.q = false;
        }
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        let n = &io.nodes;
        let [vcc, rst, dis, gnd, out, ctrl] = [n[0], n[1], n[2], n[5], n[6], n[7]];
        s.yr(vcc, ctrl, 1.0 / 5000.0);
        s.yr(ctrl, gnd, 1.0 / 10000.0);
        s.yr(vcc, rst, 1.0 / 20000.0);
        s.yr(out, if self.q { vcc } else { gnd }, 1.0 / R_OUT);
        if !self.q {
            s.yr(dis, gnd, 1.0 / R_DIS);
        }
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("out", f64::from(self.q)));
    }
    fn save(&self) -> Vec<f64> {
        vec![f64::from(self.q)]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.q = v != 0.0;
        }
    }
}
