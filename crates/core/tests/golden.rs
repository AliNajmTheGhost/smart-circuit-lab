//! Parity with the original TypeScript engine.
//!
//! `scripts/make-golden.ts` ran every example, lesson and stress circuit through the TypeScript
//! engine and saved node voltages, pin currents, live readings and damage every few steps.
//! The Rust core must reproduce them. Differences come only from the last bits of `exp`/`sin`
//! (different maths libraries), so the tolerance is tight.

use nabd_core::{CircuitDoc, Engine};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[derive(Deserialize)]
struct PartFrame {
    cur: Vec<f64>,
    extra: HashMap<String, f64>,
    broken: bool,
}

#[derive(Deserialize)]
struct Frame {
    step: usize,
    t: f64,
    x: Vec<f64>,
    parts: HashMap<String, PartFrame>,
}

#[derive(Deserialize, Debug, PartialEq)]
struct Damage {
    step: usize,
    part: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    doc: CircuitDoc,
    dt: f64,
    steps: usize,
    node_count: usize,
    n: usize,
    pin_nodes: HashMap<String, Vec<i32>>,
    failure: Option<String>,
    rough_steps: u64,
    damage: Vec<Damage>,
    frames: Vec<Frame>,
}

/// Relative-plus-absolute closeness. `scale` is the typical size of the quantity in this circuit,
/// so a value crossing zero is judged against the circuit's own magnitudes.
fn close(a: f64, b: f64, scale: f64) -> bool {
    if a == b {
        return true;
    }
    // Multimeter "OL" was saved as ±1e300.
    if b.abs() >= 1e299 {
        return a.is_infinite() && a.signum() == b.signum();
    }
    (a - b).abs() <= 1e-6 * scale.max(a.abs()).max(b.abs()) + 1e-12
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("golden")
}

fn run_case(path: &PathBuf) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let case: Case = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = &case.name;
    let mut e = Engine::new(&case.doc, case.dt, &HashSet::new());
    if e.net.node_count != case.node_count || e.n != case.n {
        return Err(format!("{name}: node count {}/{} vs {}/{}", e.net.node_count, e.n, case.node_count, case.n));
    }
    for (i, p) in case.doc.parts.iter().enumerate() {
        if e.net.pin_nodes[i] != case.pin_nodes[&p.id] {
            return Err(format!("{name}: pin nodes of {} differ: {:?} vs {:?}", p.label, e.net.pin_nodes[i], case.pin_nodes[&p.id]));
        }
    }

    // Typical sizes, for judging values near zero.
    let vscale = case.frames.iter().flat_map(|f| f.x.iter()).fold(0.0f64, |m, v| m.max(v.abs()));
    let iscale = case.frames.iter().flat_map(|f| f.parts.values()).flat_map(|p| p.cur.iter()).fold(0.0f64, |m, v| m.max(v.abs()));

    let mut damage = Vec::new();
    let mut frames = case.frames.iter().peekable();
    let mut worst = 0.0f64;
    for step in 1..=case.steps {
        for d in e.step() {
            damage.push(Damage { step, part: d.part, key: d.issue.key.to_string() });
        }
        if let Some(f) = frames.next_if(|f| f.step == step) {
            if !close(e.t, f.t, f.t) {
                return Err(format!("{name} step {step}: t {} vs {}", e.t, f.t));
            }
            for (i, (&a, &b)) in e.x.iter().zip(&f.x).enumerate() {
                worst = worst.max((a - b).abs() / vscale.max(1e-9));
                if !close(a, b, vscale) {
                    return Err(format!("{name} step {step}: node {i} voltage {a} vs {b}"));
                }
            }
            for d in &e.devices {
                let want = &f.parts[&d.id];
                if d.io.broken != want.broken {
                    return Err(format!("{name} step {step}: {} broken {} vs {}", d.id, d.io.broken, want.broken));
                }
                for (k, (&a, &b)) in d.io.cur.iter().zip(&want.cur).enumerate() {
                    if !close(a, b, iscale) {
                        return Err(format!("{name} step {step}: {} ({}) pin {k} current {a} vs {b}", d.id, d.kind, ));
                    }
                }
                let extra = e.extra(&d.id);
                if extra.len() != want.extra.len() {
                    return Err(format!("{name} step {step}: {} ({}) extra keys {:?} vs {:?}", d.id, d.kind, extra, want.extra));
                }
                for (k, a) in extra {
                    let b = want.extra[k];
                    if !close(a, b, b.abs().max(1e-3)) {
                        return Err(format!("{name} step {step}: {} ({}) {k} {a} vs {b}", d.id, d.kind));
                    }
                }
            }
        }
        if e.failure.is_some() {
            break;
        }
    }
    if damage != case.damage {
        return Err(format!("{name}: damage {damage:?} vs {:?}", case.damage));
    }
    let failure = e.failure.map(|f| f.key().to_string());
    if failure != case.failure {
        return Err(format!("{name}: failure {failure:?} vs {:?}", case.failure));
    }
    if e.rough_steps != case.rough_steps {
        return Err(format!("{name}: rough steps {} vs {}", e.rough_steps, case.rough_steps));
    }
    Ok(format!("{name}: ok (worst node deviation {worst:.1e} of full scale)"))
}

#[test]
fn matches_typescript_engine() {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(golden_dir())
        .expect("golden files exist; run `npx tsx scripts/make-golden.ts`")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json") && p.file_stem().is_some_and(|s| s != "curves"))
        .collect();
    paths.sort();
    assert!(paths.len() > 40, "expected the full golden set, found {}", paths.len());
    let mut failures = Vec::new();
    for p in &paths {
        match run_case(p) {
            Ok(msg) => println!("{msg}"),
            Err(msg) => failures.push(msg),
        }
    }
    assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), paths.len(), failures.join("\n"));
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenPlot {
    x_label: String,
    y_label: String,
    curves: Vec<GoldenCurve>,
}

#[derive(Deserialize)]
struct GoldenCurve {
    label: String,
    pts: Vec<GoldenPoint>,
}

#[derive(Deserialize)]
struct GoldenPoint {
    v: f64,
    i: f64,
}

#[test]
fn curve_tracer_matches_typescript() {
    let text = std::fs::read_to_string(golden_dir().join("curves.json")).unwrap();
    let golden: HashMap<String, GoldenPlot> = serde_json::from_str(&text).unwrap();
    assert_eq!(golden.len(), 9);
    for (kind, want) in &golden {
        let params = nabd_core::catalog::catalog().default_params(kind);
        let got = nabd_core::curves::trace_curves(kind, &params).unwrap();
        assert_eq!((got.x_label, got.y_label), (want.x_label.as_str(), want.y_label.as_str()), "{kind}");
        assert_eq!(got.curves.len(), want.curves.len(), "{kind}");
        for (g, w) in got.curves.iter().zip(&want.curves) {
            assert_eq!(g.label, w.label, "{kind}");
            let iscale = w.pts.iter().fold(0.0f64, |m, p| m.max(p.i.abs()));
            for (a, b) in g.pts.iter().zip(&w.pts) {
                assert!(close(a.v, b.v, 10.0) && close(a.i, b.i, iscale), "{kind} {}: ({}, {}) vs ({}, {})", w.label, a.v, a.i, b.v, b.i);
            }
        }
    }
}
