//! Building circuits in code (curve tracer test rigs, tests, generated exam circuits),
//! and the wire tidying the editor applies after every change.

use crate::catalog::catalog;
use crate::doc::{CircuitDoc, ParamValue, Part, Pt, Wire};
use std::collections::HashSet;

pub struct Builder {
    pub doc: CircuitDoc,
    seq: u32,
}

impl Builder {
    pub fn new(title: &str) -> Self {
        Self { doc: CircuitDoc { version: 1, title: title.to_string(), parts: Vec::new(), wires: Vec::new() }, seq: 0 }
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{prefix}{}", self.seq)
    }

    /// Place a part with its default values, overridden by `params`. Returns its id.
    pub fn add(&mut self, kind: &str, x: f64, y: f64, rot: i32, params: &[(&str, ParamValue)]) -> String {
        let cat = catalog();
        let mut p = cat.default_params(kind);
        for (k, v) in params {
            p.insert((*k).to_string(), v.clone());
        }
        let id = self.next_id("p");
        let label = self.next_label(kind);
        self.doc.parts.push(Part { id: id.clone(), kind: kind.to_string(), x, y, rot, flip: false, label, params: p });
        id
    }

    fn next_label(&self, kind: &str) -> String {
        let prefix = kind.chars().next().map(|c| c.to_ascii_uppercase()).unwrap_or('X');
        let used: HashSet<&str> = self.doc.parts.iter().map(|p| p.label.as_str()).collect();
        (1..).map(|i| format!("{prefix}{i}")).find(|l| !used.contains(l.as_str())).unwrap_or_default()
    }

    pub fn pin(&self, id: &str, i: usize) -> Pt {
        let p = self.doc.part(id).expect("part exists");
        catalog().pin_world(p, i)
    }

    /// A wire through the given points, in order.
    pub fn path(&mut self, pts: &[(f64, f64)]) -> &mut Self {
        for w in pts.windows(2) {
            let (a, b) = (Pt::new(w[0].0, w[0].1), Pt::new(w[1].0, w[1].1));
            if a == b {
                continue;
            }
            let id = self.next_id("w");
            self.doc.wires.push(Wire { id, a, b });
        }
        self
    }

    pub fn done(mut self) -> CircuitDoc {
        normalize_wires(&mut self.doc, &mut self.seq);
        self.doc
    }
}

/// All points where things can connect: pins and wire ends, in first-seen order.
fn connection_points(doc: &CircuitDoc) -> Vec<Pt> {
    let cat = catalog();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |p: Pt| {
        if seen.insert(p.key()) {
            out.push(p);
        }
    };
    for p in &doc.parts {
        for i in 0..cat.pin_count(&p.kind) {
            add(cat.pin_world(p, i));
        }
    }
    for w in &doc.wires {
        add(w.a);
        add(w.b);
    }
    out
}

fn dist2(a: Pt, b: Pt) -> f64 {
    (a.x - b.x).powi(2) + (a.y - b.y).powi(2)
}

fn strictly_inside(p: Pt, a: Pt, b: Pt) -> bool {
    let cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if cross != 0.0 {
        return false;
    }
    let dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    dot > 0.0 && dot < dist2(a, b)
}

/// Keep wiring tidy: a wire that passes over a pin or another wire's end is split there so they
/// connect; zero-length and duplicate wires are removed.
pub fn normalize_wires(doc: &mut CircuitDoc, seq: &mut u32) {
    let pts = connection_points(doc);
    let mut out = Vec::with_capacity(doc.wires.len());
    let mut seen = HashSet::new();
    for w in &doc.wires {
        let mut inner: Vec<Pt> = pts.iter().copied().filter(|&p| strictly_inside(p, w.a, w.b)).collect();
        inner.sort_by(|p, q| dist2(w.a, *p).total_cmp(&dist2(w.a, *q)));
        let chain: Vec<Pt> = std::iter::once(w.a).chain(inner).chain(std::iter::once(w.b)).collect();
        for (i, seg) in chain.windows(2).enumerate() {
            let (a, b) = (seg[0], seg[1]);
            if a == b || seen.contains(&(b.key(), a.key())) || !seen.insert((a.key(), b.key())) {
                continue;
            }
            let id = if i == 0 {
                w.id.clone()
            } else {
                *seq += 1;
                format!("w{seq}")
            };
            out.push(Wire { id, a, b });
        }
    }
    doc.wires = out;
}

/// Shorthand for numeric parameters.
pub fn num(v: f64) -> ParamValue {
    ParamValue::Num(v)
}
