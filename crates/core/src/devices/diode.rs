//! Two-terminal junctions: rectifier, Schottky and Zener diodes, LEDs, photodiode,
//! infrared transmitter and receiver. Pins: anode, cathode.

use super::junction::{GMIN, VT, pnjlim, safe_exp, vcrit};
use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiodeKind {
    Diode,
    Schottky,
    Zener,
    Led,
    Photodiode,
    IrLed,
    IrReceiver,
}

impl DiodeKind {
    /// Light-emitting kinds: rated current, brightness and burn-out work the same way.
    fn emits(self) -> bool {
        matches!(self, DiodeKind::Led | DiodeKind::IrLed)
    }
}

/// Forward voltage of an LED colour at its rated 10 mA.
pub fn led_vf(color: &str) -> f64 {
    match color {
        "green" => 2.1,
        "yellow" => 2.0,
        "blue" | "white" => 3.0,
        _ => 1.8,
    }
}

/// Saturation current and emission voltage of an LED of the given colour.
pub fn led_model(color: &str) -> (f64, f64) {
    let nvt = 2.0 * VT;
    (0.01 / (led_vf(color) / nvt).exp(), nvt)
}

#[derive(Debug)]
pub struct Diode {
    kind: DiodeKind,
    is: f64,
    nvt: f64,
    /// Zener breakdown voltage (0 for other kinds) and the current at the knee.
    vz: f64,
    ibv: f64,
    imax: f64,
    pmax: f64,
    light: f64,
    isc: f64,
    blocked: bool,
    channel: String,
    v_last: f64,
}

impl Diode {
    pub fn new(kind: DiodeKind) -> Self {
        Self { kind, is: 2.5e-9, nvt: 1.75 * VT, vz: 0.0, ibv: 0.0, imax: 1.0, pmax: 0.5, light: 0.0, isc: 0.0, blocked: false, channel: String::new(), v_last: 0.0 }
    }

    /// Reverse current made by light (photodiode and infrared receiver).
    fn photo(&self, c: &Ctx) -> f64 {
        match self.kind {
            DiodeKind::Photodiode => self.light * self.isc,
            DiodeKind::IrReceiver if !self.blocked => (c.ir_light / 0.02) * self.isc,
            _ => 0.0,
        }
    }

    #[inline]
    fn iv(&self, v: f64) -> (f64, f64) {
        let e = safe_exp(v / self.nvt);
        let mut i = self.is * (e - 1.0);
        let mut g = (self.is * e) / self.nvt;
        if self.vz > 0.0 {
            let ez = safe_exp(-(v + self.vz) / self.nvt);
            i -= self.ibv * ez;
            g += (self.ibv * ez) / self.nvt;
        }
        (i, g)
    }
}

impl Model for Diode {
    fn configure(&mut self, p: &Params) {
        let (is, nvt, vz, ibv) = match self.kind {
            DiodeKind::Schottky => (1e-6, 1.05 * VT, 0.0, 0.0),
            DiodeKind::Zener => (2.5e-9, 1.75 * VT, p.num("Vz", 5.1).max(0.5), 5e-3),
            DiodeKind::Led => {
                let (is, nvt) = led_model(&p.text("color"));
                (is, nvt, 0.0, 0.0)
            }
            // Infrared LEDs drop about 1.2 V at 10 mA.
            DiodeKind::IrLed => (0.01 / (1.2 / (2.0 * VT)).exp(), 2.0 * VT, 0.0, 0.0),
            _ => (2.5e-9, 1.75 * VT, 0.0, 0.0),
        };
        (self.is, self.nvt, self.vz, self.ibv) = (is, nvt, vz, ibv);
        let emits = self.kind.emits();
        self.imax = p.num("Imax", if emits { 0.02 } else { 1.0 });
        self.pmax = p.num("Pmax", 0.5);
        self.light = p.num("light", 0.5).clamp(0.0, 1.0);
        self.isc = p.num("Isc", if self.kind == DiodeKind::IrReceiver { 200e-6 } else { 100e-6 });
        self.blocked = p.text("path") == "blocked";
        self.channel = p.text("ch");
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        if io.broken {
            return;
        }
        let raw = io.vd(c.x, 0, 1);
        let v = if self.vz > 0.0 && raw < -self.vz / 2.0 {
            let vcrit_z = self.nvt * (self.nvt / (std::f64::consts::SQRT_2 * self.ibv)).ln();
            -pnjlim(-(raw + self.vz), -(self.v_last + self.vz), self.nvt, vcrit_z) - self.vz
        } else {
            pnjlim(raw, self.v_last, self.nvt, vcrit(self.is, self.nvt))
        };
        io.limited = (v - raw).abs() > 1e-9;
        self.v_last = v;
        let (i, g) = self.iv(v);
        let (a, k) = (io.nodes[0], io.nodes[1]);
        s.g(a, k, g + GMIN);
        s.flow(a, k, i - g * v);
        let ph = self.photo(c);
        if ph != 0.0 {
            s.flow(k, a, ph);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if io.broken {
            io.zero();
            return;
        }
        let v = io.vd(c.x, 0, 1);
        self.v_last = v;
        let i = self.iv(v).0 + GMIN * v - self.photo(c);
        io.set2(i);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if !io.broken {
            s.yr(io.nodes[0], io.nodes[1], self.iv(self.v_last).1 + GMIN);
        }
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0];
        if self.kind.emits() {
            return (i > 3.0 * self.imax).then(|| Issue::burn("burn.led", &[("i", i), ("max", self.imax)]));
        }
        if self.kind == DiodeKind::Zener {
            let p = (i * self.v_last).abs();
            return (p > 2.0 * self.pmax).then(|| Issue::burn("burn.zener", &[("p", p), ("max", self.pmax)]));
        }
        (i.abs() > 2.0 * self.imax).then(|| Issue::burn("burn.diode", &[("i", i.abs()), ("max", self.imax)]))
    }
    fn advice(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        if !self.kind.emits() {
            return None;
        }
        if io.cur[0] > 1.5 * self.imax {
            return Some(Issue::warn("warn.ledHigh", &[("i", io.cur[0]), ("max", self.imax)]));
        }
        (self.v_last < -1.0).then(|| Issue::info("info.ledReverse"))
    }
    fn extra(&self, c: &Ctx, io: &Io, out: &mut Extra) {
        if self.kind.emits() {
            out.push(("brightness", io.cur[0].max(0.0) / self.imax));
        } else if self.kind == DiodeKind::IrReceiver {
            out.push(("light", self.photo(c)));
        }
    }
    fn save(&self) -> Vec<f64> {
        vec![self.v_last]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.v_last = v;
        }
    }
    fn ir_tx_channel(&self) -> Option<&str> {
        (self.kind == DiodeKind::IrLed).then_some(self.channel.as_str())
    }
    fn ir_rx_channel(&self) -> Option<&str> {
        (self.kind == DiodeKind::IrReceiver).then_some(self.channel.as_str())
    }
}
