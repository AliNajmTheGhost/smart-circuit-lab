//! Characteristic curves of a single part, measured the way a curve tracer does:
//! the part alone in a test circuit, with its source voltage swept point by point.

use crate::builder::{Builder, num};
use crate::doc::{ParamValue, Params};
use crate::engine::Engine;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct IvPoint {
    pub v: f64,
    pub i: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IvCurve {
    pub label: String,
    pub pts: Vec<IvPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IvPlot {
    pub x_label: &'static str,
    pub y_label: &'static str,
    pub curves: Vec<IvCurve>,
}

const DIODES: [&str; 5] = ["diode", "zener", "schottky", "led", "photodiode"];

pub fn can_trace(kind: &str) -> bool {
    DIODES.contains(&kind) || matches!(kind, "npn" | "pnp" | "nmos" | "pmos")
}

/// Settle the circuit at the present source values; damage is ignored so the whole curve can be drawn.
fn settle(e: &mut Engine) {
    for _ in 0..4 {
        e.step();
        for d in &mut e.devices {
            d.io.broken = false;
        }
    }
}

fn range(a: f64, b: f64, n: usize) -> impl Iterator<Item = f64> {
    (0..n).map(move |i| a + ((b - a) * i as f64) / (n - 1) as f64)
}

fn with(params: &Params, extra: &[(&str, ParamValue)]) -> Vec<(String, ParamValue)> {
    let mut v: Vec<(String, ParamValue)> = params.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    for (k, val) in extra {
        v.retain(|(key, _)| key != k);
        v.push(((*k).to_string(), val.clone()));
    }
    v
}

fn add_with(b: &mut Builder, kind: &str, x: f64, y: f64, rot: i32, params: &[(String, ParamValue)]) -> String {
    let refs: Vec<(&str, ParamValue)> = params.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    b.add(kind, x, y, rot, &refs)
}

/// Curves for a part of type `kind` with the given values. `None` for parts that cannot be traced.
pub fn trace_curves(kind: &str, params: &Params) -> Option<IvPlot> {
    if DIODES.contains(&kind) {
        Some(diode_curve(kind, params))
    } else if kind == "npn" || kind == "pnp" {
        Some(bjt_curves(kind, params))
    } else if kind == "nmos" || kind == "pmos" {
        Some(fet_curves(kind, params))
    } else {
        None
    }
}

fn diode_curve(kind: &str, params: &Params) -> IvPlot {
    let mut b = Builder::new("");
    let src = b.add("battery", 0.0, 0.0, 0, &[("V", num(0.0)), ("r", num(0.001))]);
    b.add("ground", 0.0, 40.0, 0, &[]);
    let rs = match kind {
        "led" => 47.0,
        "zener" => 22.0,
        _ => 10.0,
    };
    b.add("resistor", 100.0, -40.0, 0, &[("R", num(rs)), ("Pmax", num(1e6))]);
    let d = add_with(&mut b, kind, 180.0, 0.0, 1, &with(params, &[]));
    b.path(&[(0.0, -40.0), (60.0, -40.0)]);
    b.path(&[(140.0, -40.0), (180.0, -40.0)]);
    b.path(&[(180.0, 40.0), (0.0, 40.0)]);
    let doc = b.done();
    let mut e = Engine::new(&doc, 1e-5, &HashSet::new());
    let vz = params.get("Vz").and_then(ParamValue::as_num).filter(|v| *v != 0.0 && v.is_finite()).unwrap_or(5.1);
    let lo = if kind == "zener" { -(vz + 2.0) } else { -5.0 };
    let hi = if kind == "led" { 5.0 } else { 2.5 };
    let pts = range(lo, hi, 160)
        .map(|v| {
            e.set_param(&src, "V", num(v));
            settle(&mut e);
            let r = e.reading(&d).expect("diode exists");
            IvPoint { v: r.v, i: r.i }
        })
        .collect();
    IvPlot { x_label: "V", y_label: "I", curves: vec![IvCurve { label: String::new(), pts }] }
}

fn bjt_curves(kind: &str, params: &Params) -> IvPlot {
    let pol = if kind == "npn" { 1.0 } else { -1.0 };
    let mut b = Builder::new("");
    let vbb = b.add("battery", 0.0, 0.0, 0, &[("V", num(0.0)), ("r", num(0.001))]);
    b.add("ground", 0.0, 40.0, 0, &[]);
    b.add("resistor", 100.0, -40.0, 0, &[("R", num(100000.0)), ("Pmax", num(1e6))]);
    let q = add_with(&mut b, kind, 180.0, -40.0, 0, &with(params, &[("Pmax", num(1e6))]));
    let vcc = b.add("battery", 300.0, 0.0, 0, &[("V", num(0.0)), ("r", num(0.001))]);
    b.path(&[(0.0, -40.0), (60.0, -40.0)]);
    b.path(&[(200.0, -80.0), (300.0, -80.0), (300.0, -40.0)]);
    b.path(&[(200.0, 0.0), (200.0, 40.0), (0.0, 40.0)]);
    b.path(&[(300.0, 40.0), (200.0, 40.0)]);
    let doc = b.done();
    let curves = [10e-6, 20e-6, 30e-6, 40e-6, 50e-6]
        .iter()
        .map(|&ib| {
            let mut e = Engine::new(&doc, 1e-5, &HashSet::new());
            e.set_param(&vbb, "V", num(pol * (0.65 + ib * 100000.0)));
            let mut ib_measured = 0.0;
            let pts = range(0.0, 10.0, 80)
                .map(|v| {
                    e.set_param(&vcc, "V", num(pol * v));
                    settle(&mut e);
                    let get = |k| e.extra_value(&q, k).unwrap_or(0.0);
                    ib_measured = pol * get("ib");
                    IvPoint { v: pol * get("vce"), i: pol * get("ic") }
                })
                .collect();
            IvCurve { label: format!("Ib = {} µA", (ib_measured * 1e6).round()), pts }
        })
        .collect();
    IvPlot { x_label: "Vce", y_label: "Ic", curves }
}

fn fet_curves(kind: &str, params: &Params) -> IvPlot {
    let pol = if kind == "nmos" { 1.0 } else { -1.0 };
    let vth = params.get("Vth").and_then(ParamValue::as_num).filter(|v| *v != 0.0 && v.is_finite()).unwrap_or(2.0);
    let mut b = Builder::new("");
    let vgs = b.add("battery", 0.0, 0.0, 0, &[("V", num(0.0)), ("r", num(0.001))]);
    b.add("ground", 0.0, 40.0, 0, &[]);
    let q = add_with(&mut b, kind, 180.0, -40.0, 0, &with(params, &[]));
    let vdd = b.add("battery", 300.0, 0.0, 0, &[("V", num(0.0)), ("r", num(0.001))]);
    b.path(&[(0.0, -40.0), (140.0, -40.0)]);
    b.path(&[(200.0, -80.0), (300.0, -80.0), (300.0, -40.0)]);
    b.path(&[(200.0, 0.0), (200.0, 40.0), (0.0, 40.0)]);
    b.path(&[(300.0, 40.0), (200.0, 40.0)]);
    let doc = b.done();
    let curves = [0.5, 1.0, 1.5, 2.0, 2.5]
        .iter()
        .map(|&over| {
            let mut e = Engine::new(&doc, 1e-5, &HashSet::new());
            let g = vth + over;
            e.set_param(&vgs, "V", num(pol * g));
            let pts = range(0.0, 10.0, 80)
                .map(|v| {
                    e.set_param(&vdd, "V", num(pol * v));
                    settle(&mut e);
                    let get = |k| e.extra_value(&q, k).unwrap_or(0.0);
                    IvPoint { v: pol * get("vds"), i: pol * get("id") }
                })
                .collect();
            IvCurve { label: format!("Vgs = {g:.1} V"), pts }
        })
        .collect();
    IvPlot { x_label: "Vds", y_label: "Id", curves }
}
