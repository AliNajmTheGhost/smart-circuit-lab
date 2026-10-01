//! Voltage sources: battery, AC mains, function generator, bench power supply.

use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};
use std::f64::consts::{PI, TAU};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Emf {
    Dc,
    Sine,
    FuncGen,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
enum Wave {
    #[default]
    Sine,
    Square,
    Triangle,
    Pulse,
    Pwm,
    Am,
    Fm,
    Pam,
    Ppm,
    Ask,
    Fsk,
    Psk,
}

impl Wave {
    fn parse(s: &str) -> Self {
        match s {
            "square" => Wave::Square,
            "triangle" => Wave::Triangle,
            "pulse" => Wave::Pulse,
            "pwm" => Wave::Pwm,
            "am" => Wave::Am,
            "fm" => Wave::Fm,
            "pam" => Wave::Pam,
            "ppm" => Wave::Ppm,
            "ask" => Wave::Ask,
            "fsk" => Wave::Fsk,
            "psk" => Wave::Psk,
            _ => Wave::Sine,
        }
    }
}

/// An ideal voltage behind a small internal resistance. The three source types differ only in
/// how the voltage changes with time.
#[derive(Debug)]
pub struct Battery {
    kind: Emf,
    rint: f64,
    v: f64,
    vp: f64,
    f: f64,
    wave: Wave,
    duty: f64,
    duty_ppm: f64,
    fm: f64,
    m: f64,
    dev: f64,
    offset: f64,
}

impl Battery {
    pub fn new(kind: Emf) -> Self {
        Self { kind, rint: 0.1, v: 0.0, vp: 0.0, f: 0.0, wave: Wave::Sine, duty: 0.5, duty_ppm: 0.1, fm: 100.0, m: 0.5, dev: 50.0, offset: 0.0 }
    }

    pub fn emf(&self, t: f64) -> f64 {
        match self.kind {
            Emf::Dc => self.v,
            Emf::Sine => self.vp * (2.0 * PI * self.f * t).sin(),
            Emf::FuncGen => self.offset + self.vp * self.wave_at(t),
        }
    }

    fn wave_at(&self, t: f64) -> f64 {
        let (f, fm) = (self.f, self.fm);
        let phase = (t * f) % 1.0;
        match self.wave {
            Wave::Square => {
                if phase < 0.5 { 1.0 } else { -1.0 }
            }
            Wave::Triangle => {
                if phase < 0.25 {
                    4.0 * phase
                } else if phase < 0.75 {
                    2.0 - 4.0 * phase
                } else {
                    4.0 * phase - 4.0
                }
            }
            Wave::Pulse => f64::from(phase < self.duty),
            Wave::Pwm => f64::from(phase < 0.5 + 0.45 * (TAU * fm * t).sin()),
            Wave::Am => (1.0 + self.m * (TAU * fm * t).sin()) * (TAU * f * t).sin(),
            Wave::Fm => (TAU * f * t + (self.dev / fm) * (TAU * fm * t).sin()).sin(),
            Wave::Pam => {
                if phase < self.duty { (1.0 + self.m * (TAU * fm * t).sin()) / (1.0 + self.m) } else { 0.0 }
            }
            Wave::Ppm => {
                // Fixed-width pulse whose position inside each period follows the message.
                let width = self.duty_ppm;
                let start = (0.5 - width / 2.0) * (1.0 + 0.8 * (TAU * fm * t).sin());
                f64::from(phase >= start && phase < start + width)
            }
            Wave::Ask => data_bit(t, fm) * (TAU * f * t).sin(),
            // Continuous phase: the frequency is f for a 0 and f + dev for a 1.
            Wave::Fsk => (TAU * (f * t + self.dev * ones_time(t, fm))).sin(),
            Wave::Psk => (TAU * f * t + PI * data_bit(t, fm)).sin(),
            Wave::Sine => (TAU * phase).sin(),
        }
    }
}

impl Model for Battery {
    fn configure(&mut self, p: &Params) {
        self.rint = p.num("r", 0.1).max(1e-3);
        match self.kind {
            Emf::Dc => {
                self.v = p.num("V", 9.0);
                // The short-circuit advice reads Vp when V is zero, as the interface always did.
                self.vp = p.num("Vp", 0.0);
            }
            Emf::Sine => {
                self.vp = p.num("Vp", 12.0);
                self.f = p.num("f", 50.0);
            }
            Emf::FuncGen => {
                self.vp = p.num("Vp", 2.0);
                self.f = p.num("f", 100.0).max(1e-3);
                self.fm = p.num("fm", 100.0).max(1e-3);
                self.wave = Wave::parse(&p.text("wave"));
                self.duty = p.num("duty", 0.5);
                self.duty_ppm = p.num("duty", 0.1);
                self.m = p.num("m", 0.5);
                self.dev = p.num("dev", 50.0);
                self.offset = p.num("offset", 0.0);
            }
        }
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let g = 1.0 / self.rint;
        let (p, n) = (io.nodes[0], io.nodes[1]);
        s.g(p, n, g);
        s.flow(n, p, self.emf(c.t) * g);
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let i = (io.vd(c.x, 0, 1) - self.emf(c.t)) / self.rint;
        io.set2(i);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        let g = 1.0 / self.rint;
        s.yr(io.nodes[0], io.nodes[1], g);
        if s.stimulus == io.index {
            s.flow(io.nodes[1], io.nodes[0], g);
        }
    }
    fn advice(&self, _c: &Ctx, io: &Io) -> Option<Issue> {
        let delivered = io.cur[0].abs();
        let short = match self.kind {
            Emf::Dc => (if self.v != 0.0 { self.v } else { self.vp }).abs() / self.rint,
            Emf::Sine => self.vp / self.rint,
            Emf::FuncGen => return None,
        };
        (short > 0.0 && delivered > 0.5 * short).then(|| Issue::warn("warn.short", &[("i", delivered)]))
    }
}

/// The data sent by the digital modulations: a fixed 16-bit pattern repeated at `rate` bits per second.
const DATA: [u8; 16] = [1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 1, 0];
const DATA_ONES: f64 = 8.0;
/// Number of 1 bits before each position of the pattern.
const DATA_PREFIX: [f64; 17] = {
    let mut out = [0.0; 17];
    let mut i = 0;
    while i < 16 {
        out[i + 1] = out[i] + DATA[i] as f64;
        i += 1;
    }
    out
};

fn data_bit(t: f64, rate: f64) -> f64 {
    f64::from(DATA[((t * rate).floor() as i64).rem_euclid(16) as usize])
}

/// Total time spent sending 1 bits up to t, so FSK phase stays continuous.
fn ones_time(t: f64, rate: f64) -> f64 {
    let k = (t * rate).floor();
    let cycles = (k / 16.0).floor();
    let in_cycle = (k as i64).rem_euclid(16) as usize;
    let whole = cycles * DATA_ONES + DATA_PREFIX[in_cycle];
    whole / rate + f64::from(DATA[in_cycle]) * (t - k / rate)
}

/// Bench power supply: constant voltage until the load asks for more than the current limit.
#[derive(Debug, Default)]
pub struct PowerSupply {
    v: f64,
    ilim: f64,
    cc: bool,
    flips: u32,
}

const PSU_R: f64 = 0.01;

impl Model for PowerSupply {
    fn configure(&mut self, p: &Params) {
        self.v = p.num("V", 12.0).clamp(0.0, 30.0);
        self.ilim = p.num("Ilim", 1.0).max(1e-3);
    }
    fn nonlinear(&self) -> bool {
        true
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io) {
        let (p, n) = (io.nodes[0], io.nodes[1]);
        let vout = io.vd(c.x, 0, 1);
        let mut cc = self.cc;
        if !cc && (self.v - vout) / PSU_R > self.ilim * 1.0001 {
            cc = true;
        } else if cc && vout > self.v {
            cc = false;
        }
        if cc != self.cc && self.flips < 8 {
            self.cc = cc;
            self.flips += 1;
            io.limited = true;
        }
        if self.cc {
            s.g(p, n, 1e-6);
            s.flow(n, p, self.ilim);
        } else {
            s.g(p, n, 1.0 / PSU_R);
            s.flow(n, p, self.v / PSU_R);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        self.flips = 0;
        let vout = io.vd(c.x, 0, 1);
        let i = if self.cc { vout * 1e-6 - self.ilim } else { (vout - self.v) / PSU_R };
        io.set2(i);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        s.yr(io.nodes[0], io.nodes[1], if self.cc { 1e-6 } else { 1.0 / PSU_R });
    }
    fn extra(&self, _c: &Ctx, io: &Io, out: &mut Extra) {
        out.push(("cc", f64::from(self.cc)));
        out.push(("iout", -io.cur[0]));
    }
    fn save(&self) -> Vec<f64> {
        vec![f64::from(self.cc)]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.cc = v != 0.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fsk_phase_is_continuous_across_bits() {
        let rate = 100.0;
        for k in 1..40 {
            let t = k as f64 / rate;
            let before = ones_time(t - 1e-12, rate);
            let after = ones_time(t + 1e-12, rate);
            assert!((after - before).abs() < 1e-9);
        }
    }
}
