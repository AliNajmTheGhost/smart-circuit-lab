//! PN-junction physics shared by diodes, LEDs, thyristors and transistors.

use crate::netlist::Node;
use crate::stamp::Stamper;

/// Thermal voltage at room temperature.
pub const VT: f64 = 0.025852;
/// Tiny conductance across every junction so a reverse-biased part never floats.
pub const GMIN: f64 = 1e-12;

/// `exp` clamped so a wild Newton guess cannot overflow to infinity.
#[inline]
pub fn safe_exp(v: f64) -> f64 {
    v.min(80.0).exp()
}

/// SPICE-style junction voltage limiting so Newton's method does not overshoot.
#[inline]
pub fn pnjlim(vnew: f64, vold: f64, vt: f64, vcrit: f64) -> f64 {
    if vnew > vcrit && (vnew - vold).abs() > 2.0 * vt {
        if vold > 0.0 {
            let arg = 1.0 + (vnew - vold) / vt;
            return if arg > 0.0 { vold + vt * arg.ln() } else { vcrit };
        }
        return vt * (vnew / vt).ln();
    }
    vnew
}

/// Limit how far a voltage may move in one Newton iteration (MOSFETs, op-amps).
#[inline]
pub fn step_limit(vnew: f64, vold: f64, max: f64) -> f64 {
    let d = vnew - vold;
    if d.abs() > max { vold + d.signum() * max } else { vnew }
}

/// The voltage above which a junction's current grows so fast that Newton needs limiting.
#[inline]
pub fn vcrit(is: f64, nvt: f64) -> f64 {
    nvt * (nvt / (std::f64::consts::SQRT_2 * is)).ln()
}

/// One Shockley junction with voltage limiting; building block for SCRs and display segments.
#[derive(Debug, Clone, Copy)]
pub struct Junction {
    pub is: f64,
    pub nvt: f64,
    pub v_last: f64,
}

impl Junction {
    pub const fn new(is: f64, nvt: f64) -> Self {
        Self { is, nvt, v_last: 0.0 }
    }

    /// Current and conductance at voltage `v`.
    #[inline]
    pub fn iv(&self, v: f64) -> (f64, f64) {
        let e = safe_exp(v / self.nvt);
        (self.is * (e - 1.0), (self.is * e) / self.nvt + GMIN)
    }

    /// Stamps the linearised junction from `a` to `k`. Returns true if the voltage had to be limited.
    pub fn stamp(&mut self, s: &mut Stamper, a: Node, k: Node, raw: f64) -> bool {
        let v = pnjlim(raw, self.v_last, self.nvt, vcrit(self.is, self.nvt));
        self.v_last = v;
        let (i, g) = self.iv(v);
        s.g(a, k, g);
        s.flow(a, k, i - g * v);
        (v - raw).abs() > 1e-9
    }

    pub fn current(&self, v: f64) -> f64 {
        self.iv(v).0 + GMIN * v
    }

    /// Small-signal conductance at the last operating point.
    pub fn g(&self) -> f64 {
        self.iv(self.v_last).1
    }
}
