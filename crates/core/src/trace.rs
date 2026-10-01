//! Running many steps in one call while recording chosen node voltages, for the oscilloscope.
//! Crossing from JavaScript into WebAssembly once per batch instead of once per step keeps the
//! simulation fast on weak school computers.

use crate::engine::{Engine, PartIssue};
use crate::netlist::Node;

/// Samples of a few nodes, no closer together in time than `min_interval`.
#[derive(Debug, Clone, Default)]
pub struct Trace {
    pub nodes: Vec<Node>,
    pub min_interval: f64,
    /// Sample times.
    pub t: Vec<f64>,
    /// Voltages, one row of `nodes.len()` values per sample.
    pub v: Vec<f64>,
    last_t: Option<f64>,
}

impl Trace {
    pub fn new(nodes: Vec<Node>, min_interval: f64) -> Self {
        Self { nodes, min_interval, ..Self::default() }
    }

    /// Forget the samples but keep watching the same nodes.
    pub fn clear(&mut self) {
        self.t.clear();
        self.v.clear();
    }

    /// Start over, e.g. after the simulation restarted from t = 0.
    pub fn reset(&mut self) {
        self.clear();
        self.last_t = None;
    }

    fn sample(&mut self, e: &Engine) {
        if let Some(last) = self.last_t {
            if e.t < last {
                self.last_t = None;
            } else if e.t - last < self.min_interval {
                return;
            }
        }
        self.last_t = Some(e.t);
        self.t.push(e.t);
        self.v.extend(self.nodes.iter().map(|&n| e.volt(n)));
    }
}

impl Engine {
    /// Advance up to `steps` steps, sampling into `trace` after each one.
    /// Stops early if the simulation fails. Returns the parts damaged along the way.
    pub fn run(&mut self, steps: usize, mut trace: Option<&mut Trace>) -> Vec<PartIssue> {
        let mut damaged = Vec::new();
        for _ in 0..steps {
            if self.failure.is_some() {
                break;
            }
            damaged.extend(self.step());
            if let Some(tr) = trace.as_deref_mut() {
                tr.sample(self);
            }
        }
        damaged
    }
}
