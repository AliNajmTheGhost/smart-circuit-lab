//! WebAssembly bindings of the simulation core for the browser and the desktop app.
//!
//! Hot data (node voltages, pin currents, oscilloscope samples) crosses as `Float64Array`;
//! rarer structured results (readings, doctor notes, Bode points) cross as JSON text.

use nabd_core::catalog::catalog;
use nabd_core::doctor::static_checks;
use nabd_core::engine::SavedState;
use nabd_core::trace::Trace;
use nabd_core::{CircuitDoc, Engine, ParamValue, PartIssue, Params};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn bad(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// One running simulation of one circuit.
#[wasm_bindgen]
pub struct Sim {
    engine: Engine,
    doc: CircuitDoc,
    trace: Trace,
    damage: Vec<PartIssue>,
}

#[wasm_bindgen]
impl Sim {
    /// `doc_json`: the circuit; `dt`: time step (0 picks one from the sources);
    /// `broken_json`: ids of parts that start damaged.
    #[wasm_bindgen(constructor)]
    pub fn new(doc_json: &str, dt: f64, broken_json: &str) -> Result<Sim, JsError> {
        let doc = CircuitDoc::from_json(doc_json).map_err(bad)?;
        let broken: HashSet<String> = if broken_json.is_empty() { HashSet::new() } else { serde_json::from_str(broken_json).map_err(bad)? };
        let dt = if dt > 0.0 { dt } else { doc.choose_dt() };
        let engine = Engine::new(&doc, dt, &broken);
        Ok(Sim { engine, doc, trace: Trace::default(), damage: Vec::new() })
    }

    // ---------------------------------------------------------------- stepping

    /// Advance `steps` steps, recording the watched nodes. Returns how many parts burnt;
    /// read them with `takeDamage`.
    pub fn run(&mut self, steps: u32) -> u32 {
        let d = self.engine.run(steps as usize, Some(&mut self.trace));
        let k = d.len() as u32;
        self.damage.extend(d);
        k
    }

    /// One step without recording. Returns how many parts burnt.
    pub fn step(&mut self) -> u32 {
        let d = self.engine.step();
        let k = d.len() as u32;
        self.damage.extend(d);
        k
    }

    /// Damage since the last call, as JSON `[{part, level, key, vars}]`.
    #[wasm_bindgen(js_name = takeDamage)]
    pub fn take_damage(&mut self) -> String {
        json(&std::mem::take(&mut self.damage))
    }

    /// Watch these nodes, sampling no closer than `min_interval` seconds.
    #[wasm_bindgen(js_name = watch)]
    pub fn watch(&mut self, nodes: Vec<i32>, min_interval: f64) {
        self.trace = Trace::new(nodes, min_interval);
    }

    #[wasm_bindgen(js_name = traceT)]
    pub fn trace_t(&self) -> Vec<f64> {
        self.trace.t.clone()
    }

    /// Samples, one row per time with one value per watched node.
    #[wasm_bindgen(js_name = traceV)]
    pub fn trace_v(&self) -> Vec<f64> {
        self.trace.v.clone()
    }

    #[wasm_bindgen(js_name = clearTrace)]
    pub fn clear_trace(&mut self) {
        self.trace.clear();
    }

    // ---------------------------------------------------------------- state

    #[wasm_bindgen(getter)]
    pub fn t(&self) -> f64 {
        self.engine.t
    }

    #[wasm_bindgen(getter)]
    pub fn dt(&self) -> f64 {
        self.engine.dt
    }

    /// Unknowns in the equations (wired nodes plus hidden nodes).
    #[wasm_bindgen(getter)]
    pub fn n(&self) -> usize {
        self.engine.n
    }

    /// Message key when the equations could not be solved, else undefined.
    #[wasm_bindgen(getter)]
    pub fn failure(&self) -> Option<String> {
        self.engine.failure.map(|f| f.key().to_string())
    }

    #[wasm_bindgen(getter, js_name = roughSteps)]
    pub fn rough_steps(&self) -> f64 {
        self.engine.rough_steps as f64
    }

    #[wasm_bindgen(getter, js_name = luReused)]
    pub fn lu_reused(&self) -> f64 {
        self.engine.lu.reused as f64
    }

    /// All node voltages.
    pub fn x(&self) -> Vec<f64> {
        self.engine.x.clone()
    }

    pub fn volt(&self, node: i32) -> f64 {
        self.engine.volt(node)
    }

    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> String {
        json(&self.engine.export_state())
    }

    #[wasm_bindgen(js_name = importState)]
    pub fn import_state(&mut self, state_json: &str, t: f64) -> Result<(), JsError> {
        let s: SavedState = serde_json::from_str(state_json).map_err(bad)?;
        self.engine.import_state(&s, t);
        Ok(())
    }

    // ---------------------------------------------------------------- editing

    /// Change one value while running. `value_json` is a number or a quoted string.
    #[wasm_bindgen(js_name = setParam)]
    pub fn set_param(&mut self, id: &str, key: &str, value_json: &str) -> Result<bool, JsError> {
        let v: ParamValue = serde_json::from_str(value_json).map_err(bad)?;
        if let Some(p) = self.doc.parts.iter_mut().find(|p| p.id == id) {
            p.params.insert(key.to_string(), v.clone());
        }
        Ok(self.engine.set_param(id, key, v))
    }

    /// Take the values from an edited document whose wiring is unchanged.
    #[wasm_bindgen(js_name = syncParams)]
    pub fn sync_params(&mut self, doc_json: &str) -> Result<(), JsError> {
        let doc = CircuitDoc::from_json(doc_json).map_err(bad)?;
        self.engine.sync_params(&doc);
        for p in &mut self.doc.parts {
            if let Some(q) = doc.part(&p.id) {
                p.params = q.params.clone();
            }
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = setBroken)]
    pub fn set_broken(&mut self, id: &str, broken: bool) {
        self.engine.set_broken(id, broken);
    }

    // ---------------------------------------------------------------- parts

    pub fn broken(&self, id: &str) -> bool {
        self.engine.device(id).is_some_and(|d| d.io.broken)
    }

    /// Nodes of a part's pins (and hidden nodes).
    pub fn nodes(&self, id: &str) -> Vec<i32> {
        self.engine.device(id).map(|d| d.io.nodes.clone()).unwrap_or_default()
    }

    /// Current into each pin of a part.
    pub fn cur(&self, id: &str) -> Vec<f64> {
        self.engine.device(id).map(|d| d.io.cur.clone()).unwrap_or_default()
    }

    /// Live values of a part as JSON `{name: value}`.
    pub fn extra(&self, id: &str) -> String {
        let e: serde_json::Map<String, serde_json::Value> = self.engine.extra(id).into_iter().map(|(k, v)| (k.to_string(), finite(v))).collect();
        json(&e)
    }

    /// Live values of every part at once, as JSON `{id: {name: value}}`: one call per frame
    /// instead of one per part.
    #[wasm_bindgen(js_name = allExtras)]
    pub fn all_extras(&self) -> String {
        let all: serde_json::Map<String, serde_json::Value> = self
            .engine
            .devices
            .iter()
            .map(|d| {
                let e: serde_json::Map<String, serde_json::Value> = self.engine.extra(&d.id).into_iter().map(|(k, v)| (k.to_string(), finite(v))).collect();
                (d.id.clone(), serde_json::Value::Object(e))
            })
            .collect();
        json(&all)
    }

    /// Voltage across, current through and power of a part, as JSON.
    pub fn reading(&self, id: &str) -> String {
        match self.engine.reading(id) {
            Some(r) => {
                let extra: serde_json::Map<String, serde_json::Value> = r.extra.iter().map(|(k, v)| (k.to_string(), finite(*v))).collect();
                json(&serde_json::json!({ "v": r.v, "i": r.i, "p": r.p, "extra": extra }))
            }
            None => "null".into(),
        }
    }

    /// Circuit-doctor advice from the present state, as JSON.
    pub fn advice(&self) -> String {
        json(&self.engine.advice())
    }

    /// Current in each wire, in document order.
    #[wasm_bindgen(js_name = wireCurrents)]
    pub fn wire_currents(&self) -> Vec<f64> {
        self.engine.wire_currents(&self.doc)
    }

    /// Bode plot points `[{f, db, phase}]` as JSON.
    #[wasm_bindgen(js_name = acSweep)]
    pub fn ac_sweep(&self, stimulus: &str, in_node: i32, out_node: i32, freqs: Vec<f64>) -> String {
        json(&self.engine.ac_sweep(stimulus, in_node, out_node, &freqs))
    }

    // ---------------------------------------------------------------- netlist

    #[wasm_bindgen(getter, js_name = nodeCount)]
    pub fn node_count(&self) -> usize {
        self.engine.net.node_count
    }

    #[wasm_bindgen(getter, js_name = hasGround)]
    pub fn has_ground(&self) -> bool {
        self.engine.net.has_ground
    }

    /// Id of the source whose negative pin became 0 V when there is no ground symbol.
    #[wasm_bindgen(getter, js_name = autoGroundPart)]
    pub fn auto_ground_part(&self) -> Option<String> {
        self.engine.net.auto_ground_part.map(|i| self.doc.parts[i].id.clone())
    }

    /// Node at a board point, or undefined if nothing connects there.
    #[wasm_bindgen(js_name = pointNode)]
    pub fn point_node(&self, x: f64, y: f64) -> Option<i32> {
        self.engine.net.point_node.get(&nabd_core::Pt::new(x, y).key()).copied()
    }

    /// Notes from the drawing alone (open pins, shorted sources...), as JSON.
    #[wasm_bindgen(js_name = staticChecks)]
    pub fn static_checks(&self) -> String {
        json(&static_checks(&self.doc, &self.engine.net))
    }
}

/// JSON cannot hold infinity; a meter showing "OL" sends a huge number with the right sign.
fn finite(v: f64) -> serde_json::Value {
    let v = if v.is_finite() { v } else if v > 0.0 { 1e300 } else if v < 0.0 { -1e300 } else { 0.0 };
    serde_json::Value::from(v)
}

/// Time step the interface should use for this circuit.
#[wasm_bindgen(js_name = chooseDt)]
pub fn choose_dt(doc_json: &str) -> Result<f64, JsError> {
    Ok(CircuitDoc::from_json(doc_json).map_err(bad)?.choose_dt())
}

/// Characteristic curves of a part (`params_json`: its values), as JSON, or "null".
#[wasm_bindgen(js_name = traceCurves)]
pub fn trace_curves(kind: &str, params_json: &str) -> Result<String, JsError> {
    let params: Params = serde_json::from_str(params_json).map_err(bad)?;
    Ok(json(&nabd_core::curves::trace_curves(kind, &params)))
}

/// Number of part types this engine knows (a quick check that the module loaded).
#[wasm_bindgen(js_name = partTypes)]
pub fn part_types() -> usize {
    catalog().parts().len()
}
