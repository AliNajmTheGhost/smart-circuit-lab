//! Parts that make sound: loudspeaker and active buzzer.
//! The core measures what the student would hear (pitch and loudness at the simulated
//! frequency); the interface turns that into real sound.

use super::{Ctx, Extra, Io, Issue, Model};
use crate::doc::{Params, ParamsExt};
use crate::stamp::{AcStamper, Stamper};

/// Time constant of the running averages, in simulated seconds.
const TAU: f64 = 0.01;
/// With no zero crossing for this long, the tone has stopped.
const SILENCE: f64 = 0.1;

/// Loudspeaker (pins +, −): its coil resistance as a load, plus a pitch detector.
#[derive(Debug, Default)]
pub struct Speaker {
    r: f64,
    pmax: f64,
    mean: f64,
    mean_sq: f64,
    p_avg: f64,
    /// Above or below the average on the last step, with hysteresis.
    high: bool,
    last_rise: Option<f64>,
    freq: f64,
}

impl Speaker {
    fn rms(&self) -> f64 {
        (self.mean_sq - self.mean * self.mean).max(0.0).sqrt()
    }
}

impl Model for Speaker {
    fn configure(&mut self, p: &Params) {
        self.r = p.num("R", 8.0).max(0.1);
        self.pmax = p.num("Pmax", 0.5).max(1e-3);
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        if !io.broken {
            s.g(io.nodes[0], io.nodes[1], 1.0 / self.r);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        let v = if io.broken { 0.0 } else { io.vd(c.x, 0, 1) };
        io.set2(v / self.r);
        let a = (c.dt / TAU).min(1.0);
        self.mean += a * (v - self.mean);
        self.mean_sq += a * (v * v - self.mean_sq);
        self.p_avg += a * (v * v / self.r - self.p_avg);
        // Rising crossings of the average give the period; hysteresis ignores noise.
        let band = 0.2 * self.rms().max(1e-4);
        let ac = v - self.mean;
        if !self.high && ac > band {
            self.high = true;
            if let Some(t0) = self.last_rise {
                let f = 1.0 / (c.t - t0).max(c.dt);
                self.freq = if self.freq > 0.0 { self.freq + 0.3 * (f - self.freq) } else { f };
            }
            self.last_rise = Some(c.t);
        } else if self.high && ac < -band {
            self.high = false;
        }
        if self.last_rise.is_some_and(|t0| c.t - t0 > SILENCE) {
            self.freq = 0.0;
            self.last_rise = None;
        }
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if !io.broken {
            s.yr(io.nodes[0], io.nodes[1], 1.0 / self.r);
        }
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        (self.p_avg > 2.0 * self.pmax).then(|| Issue::burn("burn.speaker", &[("p", self.p_avg), ("max", self.pmax)]))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        let audible = self.freq > 0.0;
        out.push(("f", self.freq));
        out.push(("vrms", self.rms()));
        // Loudness 0..1 against the rated power, on a gentle curve like the ear.
        out.push(("loud", if audible { (self.p_avg / self.pmax).sqrt().min(1.0) } else { 0.0 }));
    }
    fn save(&self) -> Vec<f64> {
        vec![self.p_avg]
    }
    fn load(&mut self, s: &[f64]) {
        if let Some(&v) = s.first() {
            self.p_avg = v;
        }
    }
}

/// Active buzzer (pins +, −): beeps at its own pitch when powered with the right polarity.
#[derive(Debug, Default)]
pub struct Buzzer {
    v_rated: f64,
    r: f64,
    v: f64,
}

impl Model for Buzzer {
    fn configure(&mut self, p: &Params) {
        self.v_rated = p.num("V", 5.0).max(0.5);
        // About 30 mA at the rated voltage.
        self.r = self.v_rated / 0.03;
    }
    fn stamp(&mut self, s: &mut Stamper, _c: &Ctx, io: &mut Io) {
        if !io.broken {
            s.g(io.nodes[0], io.nodes[1], 1.0 / self.r);
        }
    }
    fn accept(&mut self, c: &Ctx, io: &mut Io) {
        self.v = if io.broken { 0.0 } else { io.vd(c.x, 0, 1) };
        io.set2(self.v / self.r);
    }
    fn ac(&self, s: &mut AcStamper, _w: f64, io: &Io) {
        if !io.broken {
            s.yr(io.nodes[0], io.nodes[1], 1.0 / self.r);
        }
    }
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        (self.v.abs() > 2.5 * self.v_rated).then(|| Issue::burn("burn.buzzer", &[("v", self.v.abs()), ("max", self.v_rated)]))
    }
    fn advice(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        (self.v < -0.5 * self.v_rated).then(|| Issue::info("info.buzzerReverse"))
    }
    fn extra(&self, _c: &Ctx, _io: &Io, out: &mut Extra) {
        // It starts at about half its rated voltage and is loudest at the rating.
        let k = ((self.v / self.v_rated - 0.5) / 0.5).clamp(0.0, 1.0);
        out.push(("on", f64::from(k > 0.0)));
        out.push(("loud", k));
    }
}

#[cfg(test)]
mod tests {
    use crate::builder::{Builder, num};
    use crate::engine::Engine;
    use crate::doc::ParamValue;

    #[test]
    fn speaker_hears_the_source_frequency() {
        let mut b = Builder::new("");
        b.add("funcgen", 0.0, 0.0, 0, &[("f", num(440.0)), ("Vp", num(1.0)), ("wave", ParamValue::Text("sine".into()))]);
        b.add("ground", 0.0, 40.0, 0, &[]);
        let spk = b.add("speaker", 100.0, 0.0, 1, &[]);
        b.path(&[(0.0, -40.0), (100.0, -40.0)]);
        b.path(&[(0.0, 40.0), (100.0, 40.0)]);
        let doc = b.done();
        let mut e = Engine::from_doc(&doc);
        e.run(20000, None);
        let f = e.extra_value(&spk, "f").unwrap();
        assert!((f - 440.0).abs() < 5.0, "heard {f} Hz");
        assert!(e.extra_value(&spk, "loud").unwrap() > 0.0);
    }
}
