//! Measuring instruments: voltmeter, ammeter and the AVO multimeter.
//! Readings are smoothed over about 40 ms like a real meter's needle or display.

use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

/// Running mean and mean-square of the measured quantity.
#[derive(Debug, Default, Clone, Copy)]
struct Average {
    mean: f64,
    mean_sq: f64,
    started: bool,
}

impl Average {
    fn track(&mut self, s: f64, dt: f64) {
        if !self.started {
            self.mean = s;
            self.mean_sq = s * s;
            self.started = true;
            return;
        }
        let a = (dt / 0.04).min(1.0);
        self.mean += a * (s - self.mean);
        self.mean_sq += a * (s * s - self.mean_sq);
    }
    /// DC: the average. AC: the RMS of what is left after removing the average.
    fn reading(&self, ac: bool) -> f64 {
        if ac { (self.mean_sq - self.mean * self.mean).max(0.0).sqrt() } else { self.mean }
    }
    fn save(&self) -> Vec<f64> {
        vec![self.mean, self.mean_sq, f64::from(self.started)]
    }
    fn load(&mut self, s: &[f64]) {
        if s.len() >= 3 {
            self.mean = s[0];
            self.mean_sq = s[1];
            self.started = s[2] != 0.0;
        }
    }
}

const R_VOLT_G: f64 = 1e-7;
const R_AMP_G: f64 = 100.0;

#[derive(Debug, Default)]
pub struct Voltmeter {
    ac: bool,
    avg: Average,
}

impl Model for Voltmeter {
    fn configure(&mut self, p: &Params) {
        self.ac = p.text("mode") == "ac";
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        s.g(io.nodes[0], io.nodes[1], R_VOLT_G);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let v = io.vd(c.x, 0, 1);
        io.set2(v * R_VOLT_G);
        self.avg.track(v, c.dt);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], io.nodes[1], R_VOLT_G);
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("reading", self.avg.reading(self.ac)));
    }
    fn save(&self) -> Vec<f64> {
        self.avg.save()
    }
    fn load(&mut self, s: &[f64]) {
        self.avg.load(s);
    }
}

#[derive(Debug, Default)]
pub struct Ammeter {
    ac: bool,
    avg: Average,
}

impl Model for Ammeter {
    fn configure(&mut self, p: &Params) {
        self.ac = p.text("mode") == "ac";
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        if !io.broken {
            s.g(io.nodes[0], io.nodes[1], R_AMP_G);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let i = if io.broken { 0.0 } else { io.vd(c.x, 0, 1) * R_AMP_G };
        io.set2(i);
        self.avg.track(i, c.dt);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if !io.broken {
            s.yr(io.nodes[0], io.nodes[1], R_AMP_G);
        }
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0].abs();
        (i > 10.0).then(|| Issue::burn("burn.ammeter", &[("i", i)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("reading", self.avg.reading(self.ac)));
    }
    fn save(&self) -> Vec<f64> {
        self.avg.save()
    }
    fn load(&mut self, s: &[f64]) {
        self.avg.load(s);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum AvoMode {
    #[default]
    Vdc,
    Vac,
    Adc,
    Aac,
    Ohm,
    Diode,
}

impl AvoMode {
    fn parse(s: &str) -> Self {
        match s {
            "vac" => AvoMode::Vac,
            "adc" => AvoMode::Adc,
            "aac" => AvoMode::Aac,
            "ohm" => AvoMode::Ohm,
            "diode" => AvoMode::Diode,
            _ => AvoMode::Vdc,
        }
    }
    fn amps(self) -> bool {
        matches!(self, AvoMode::Adc | AvoMode::Aac)
    }
    fn ac(self) -> bool {
        matches!(self, AvoMode::Vac | AvoMode::Aac)
    }
    /// Test voltage and series resistance of the meter's own battery (ohms and diode test).
    fn source(self) -> Option<(f64, f64)> {
        match self {
            AvoMode::Ohm => Some((1.0, 1000.0)),
            AvoMode::Diode => Some((3.0, 3000.0)),
            _ => None,
        }
    }
}

/// The AVO meter. Volts: 10 MΩ. Amps: 0.01 Ω with a 10 A fuse.
/// Ohms and diode test: the meter pushes a small current from its own battery and reads V ÷ I,
/// which is why the circuit must be switched off first.
#[derive(Debug, Default)]
pub struct Multimeter {
    mode: AvoMode,
    last_mode: Option<AvoMode>,
    avg: Average,
    ohm_v: f64,
    ohm_i: f64,
}

impl Multimeter {
    /// Reading in the unit of the current mode; infinity means "OL" (over limit).
    pub fn reading(&self) -> f64 {
        match self.mode {
            AvoMode::Ohm => {
                if self.ohm_i <= 1e-11 {
                    return f64::INFINITY;
                }
                let r = self.ohm_v / self.ohm_i;
                if !(0.0..=40e6).contains(&r) { f64::INFINITY } else { r }
            }
            AvoMode::Diode => {
                if self.ohm_v > 2.5 {
                    f64::INFINITY
                } else {
                    self.ohm_v
                }
            }
            m => self.avg.reading(m.ac()),
        }
    }
}

impl Model for Multimeter {
    fn configure(&mut self, p: &Params) {
        self.mode = AvoMode::parse(&p.text("mode"));
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        let (p, n) = (io.nodes[0], io.nodes[1]);
        if let Some((vt, rs)) = self.mode.source() {
            s.g(p, n, 1.0 / rs);
            s.flow(n, p, vt / rs);
        } else if self.mode.amps() {
            if !io.broken {
                s.g(p, n, R_AMP_G);
            }
        } else {
            s.g(p, n, R_VOLT_G);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        if self.last_mode != Some(self.mode) {
            self.last_mode = Some(self.mode);
            self.avg.started = false;
        }
        let v = io.vd(c.x, 0, 1);
        let src = self.mode.source();
        let i = if let Some((vt, rs)) = src {
            let i = (v - vt) / rs;
            self.ohm_v = v;
            self.ohm_i = -i;
            i
        } else if self.mode.amps() {
            if io.broken { 0.0 } else { v * R_AMP_G }
        } else {
            v * R_VOLT_G
        };
        io.set2(i);
        if src.is_none() {
            let sample = if self.mode.amps() { io.cur[0] } else { v };
            self.avg.track(sample, c.dt);
        }
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        let g = match self.mode.source() {
            Some((_, rs)) => 1.0 / rs,
            None if self.mode.amps() => R_AMP_G,
            None => R_VOLT_G,
        };
        s.yr(io.nodes[0], io.nodes[1], g);
    }
    fn limits(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let i = io.cur[0].abs();
        (self.mode.amps() && i > 10.0).then(|| Issue::burn("burn.ammeter", &[("i", i)]))
    }
    fn advice(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        let (vt, _) = self.mode.source()?;
        // On a passive part the meter's own voltage can only fall between 0 and its test voltage.
        (self.ohm_v > vt + 0.01 || self.ohm_v < -0.01 || self.ohm_i < -1e-9).then(|| Issue::warn("warn.ohmPowered", &[]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        out.push(("reading", self.reading()));
    }
    fn save(&self) -> Vec<f64> {
        self.avg.save()
    }
    fn load(&mut self, s: &[f64]) {
        self.avg.load(s);
    }
}
