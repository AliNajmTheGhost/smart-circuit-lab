//! Electrical models of the parts. Each family lives in its own file; [`create`] picks the model
//! for a part type. To add a part: write a [`Model`], add it to [`create`], add a test.

mod digital;
mod diode;
mod display;
mod meters;
mod misc;
mod opamp;
mod passive;
mod semis;
mod sound;
mod sources;
mod storage;
mod timer;
mod tline;

pub mod junction;

use crate::doc::Params;
use crate::netlist::Node;
use crate::stamp::{AcStamper, Stamper};
use serde::Serialize;

/// What a model sees during one step.
#[derive(Clone, Copy)]
pub struct Ctx<'a> {
    pub t: f64,
    pub dt: f64,
    /// Node voltages: the Newton guess while stamping, the accepted solution afterwards.
    pub x: &'a [f64],
    /// Infrared light reaching this part (sum of transmitter currents on its channel).
    pub ir_light: f64,
}

/// The connections of one part and its state that the engine reads.
#[derive(Debug, Clone)]
pub struct Io {
    /// Position of the part in the document, used to recognise the Bode stimulus.
    pub index: usize,
    pub nodes: Vec<Node>,
    /// Current into each pin after the last accepted step.
    pub cur: Vec<f64>,
    pub broken: bool,
    /// Set during `stamp` when a voltage had to be limited: Newton has not converged yet.
    pub limited: bool,
}

impl Io {
    #[inline]
    pub fn v(&self, x: &[f64], pin: usize) -> f64 {
        volt(x, self.nodes[pin])
    }

    /// Voltage between two pins.
    #[inline]
    pub fn vd(&self, x: &[f64], a: usize, b: usize) -> f64 {
        self.v(x, a) - self.v(x, b)
    }

    #[inline]
    pub fn set2(&mut self, i: f64) {
        self.cur[0] = i;
        self.cur[1] = -i;
    }

    pub fn zero(&mut self) {
        self.cur.fill(0.0);
    }
}

#[inline]
pub fn volt(x: &[f64], n: Node) -> f64 {
    if n < 0 { 0.0 } else { x[n as usize] }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Burn,
    Warn,
    Info,
}

/// Something the circuit doctor should tell the student. `key` names a translated message.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Issue {
    pub level: Level,
    pub key: &'static str,
    /// Numbers for the message, e.g. the power that burnt a resistor.
    #[serde(serialize_with = "pairs_as_map")]
    pub vars: Vec<(&'static str, f64)>,
}

/// Serialise `[(name, value)]` as a JSON object `{name: value}`.
pub fn pairs_as_map<S: serde::Serializer, V: Serialize>(pairs: &[(&'static str, V)], s: S) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;
    let mut m = s.serialize_map(Some(pairs.len()))?;
    for (k, v) in pairs {
        m.serialize_entry(k, v)?;
    }
    m.end()
}

impl Issue {
    pub fn burn(key: &'static str, vars: &[(&'static str, f64)]) -> Self {
        Self { level: Level::Burn, key, vars: vars.to_vec() }
    }
    pub fn warn(key: &'static str, vars: &[(&'static str, f64)]) -> Self {
        Self { level: Level::Warn, key, vars: vars.to_vec() }
    }
    pub fn info(key: &'static str) -> Self {
        Self { level: Level::Info, key, vars: Vec::new() }
    }
}

/// Live values shown in the inspector and on the board (brightness, readings, logic levels).
pub type Extra = Vec<(&'static str, f64)>;

/// The behaviour of one part type.
pub trait Model: Send {
    /// Read the parameters. Called once at creation and again whenever a value is edited.
    fn configure(&mut self, p: &Params);
    /// Whether Newton iterations are needed (the equations depend on the voltages).
    fn nonlinear(&self) -> bool {
        false
    }
    fn stamp(&mut self, s: &mut Stamper, c: &Ctx, io: &mut Io);
    /// Called once the step has converged: update memory and pin currents.
    fn accept(&mut self, c: &Ctx, io: &mut Io);
    /// Small-signal admittance at angular frequency `w`, for the Bode plotter.
    fn ac(&self, _s: &mut AcStamper, _w: f64, _io: &Io) {}
    /// Damage check after each step. A burn issue breaks the part.
    fn limits(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        None
    }
    /// Advice shown while running (not damage).
    fn advice(&self, _c: &Ctx, _io: &Io) -> Option<Issue> {
        None
    }
    fn extra(&self, _c: &Ctx, _io: &Io, _out: &mut Extra) {}
    /// Memory carried over when the wiring changes (capacitor charge, flip-flop state...).
    fn save(&self) -> Vec<f64> {
        Vec::new()
    }
    fn load(&mut self, _s: &[f64]) {}
    /// Infrared channel this part transmits on.
    fn ir_tx_channel(&self) -> Option<&str> {
        None
    }
    /// Infrared channel this part listens to.
    fn ir_rx_channel(&self) -> Option<&str> {
        None
    }
}

/// The model for a part type. Unknown types get a model that does nothing.
pub fn create(kind: &str, p: &Params, pins: usize) -> Box<dyn Model> {
    use diode::{Diode, DiodeKind};
    let mut m: Box<dyn Model> = match kind {
        "resistor" => Box::new(passive::Resistor::default()),
        "ldr" => Box::new(passive::Ldr::default()),
        "lamp" => Box::new(passive::Lamp::default()),
        "switch" | "button" => Box::new(passive::Switch::default()),
        "fuse" => Box::new(passive::Fuse::default()),
        "pot" => Box::new(passive::Pot::default()),
        "battery" => Box::new(sources::Battery::new(sources::Emf::Dc)),
        "ac" => Box::new(sources::Battery::new(sources::Emf::Sine)),
        "funcgen" => Box::new(sources::Battery::new(sources::Emf::FuncGen)),
        "psu" => Box::new(sources::PowerSupply::default()),
        "capacitor" => Box::new(storage::Capacitor::new(false)),
        "ecap" => Box::new(storage::Capacitor::new(true)),
        "inductor" => Box::new(storage::Inductor::default()),
        "transformer" => Box::new(storage::Transformer::default()),
        "ctransformer" => Box::new(storage::CenterTap::default()),
        "diode" => Box::new(Diode::new(DiodeKind::Diode)),
        "schottky" => Box::new(Diode::new(DiodeKind::Schottky)),
        "zener" => Box::new(Diode::new(DiodeKind::Zener)),
        "led" => Box::new(Diode::new(DiodeKind::Led)),
        "photodiode" => Box::new(Diode::new(DiodeKind::Photodiode)),
        "irtx" => Box::new(Diode::new(DiodeKind::IrLed)),
        "irrx" => Box::new(Diode::new(DiodeKind::IrReceiver)),
        "scr" => Box::new(semis::Thyristor::new(false)),
        "triac" => Box::new(semis::Thyristor::new(true)),
        "npn" => Box::new(semis::Bjt::new(1.0)),
        "pnp" => Box::new(semis::Bjt::new(-1.0)),
        "nmos" => Box::new(semis::Mosfet::new(1.0)),
        "pmos" => Box::new(semis::Mosfet::new(-1.0)),
        "dff" => Box::new(digital::d_flip_flop()),
        "jkff" => Box::new(digital::jk_flip_flop()),
        "counter" => Box::new(digital::counter()),
        "bcd7" => Box::new(digital::bcd7()),
        "adc" => Box::new(digital::adc()),
        "dac" => Box::new(digital::dac()),
        "logicin" => Box::new(digital::LogicIn::default()),
        "logicout" => Box::new(digital::LogicOut::default()),
        "timer555" => Box::new(timer::Timer555::default()),
        "opamp" => Box::new(opamp::OpAmp::default()),
        "tline" => Box::new(tline::TLine::default()),
        "sevenseg" => Box::new(display::SevenSeg::default()),
        "lcd7" => Box::new(display::Lcd7::default()),
        "aswitch" => Box::new(misc::AnalogSwitch::default()),
        "voltmeter" => Box::new(meters::Voltmeter::default()),
        "ammeter" => Box::new(meters::Ammeter::default()),
        "multimeter" => Box::new(meters::Multimeter::default()),
        "probe" => Box::new(misc::Probe::default()),
        "speaker" => Box::new(sound::Speaker::default()),
        "buzzer" => Box::new(sound::Buzzer::default()),
        _ => match digital::GateFn::from_kind(kind) {
            Some(f) => Box::new(digital::gate(f, pins)),
            None => Box::new(misc::Nothing),
        },
    };
    m.configure(p);
    m
}
