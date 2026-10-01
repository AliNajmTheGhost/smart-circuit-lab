//! «طبيب الدائرة»: checks that need only the drawing, not the simulation.

use crate::catalog::{catalog, is_gate};
use crate::doc::CircuitDoc;
use crate::netlist::Netlist;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteLevel {
    Burn,
    Error,
    Warn,
    Info,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DoctorNote {
    pub level: NoteLevel,
    pub key: &'static str,
    /// Ids of the parts the note is about.
    pub parts: Vec<String>,
    #[serde(serialize_with = "crate::devices::pairs_as_map")]
    pub vars: Vec<(&'static str, String)>,
}

impl DoctorNote {
    fn new(level: NoteLevel, key: &'static str, parts: Vec<String>) -> Self {
        Self { level, key, parts, vars: Vec::new() }
    }
}

const SOURCES: [&str; 6] = ["battery", "psu", "ac", "funcgen", "logicin", "multimeter"];
const POWER: [&str; 4] = ["battery", "psu", "ac", "funcgen"];

pub fn static_checks(doc: &CircuitDoc, net: &Netlist) -> Vec<DoctorNote> {
    let cat = catalog();
    let mut notes = Vec::new();
    if doc.parts.is_empty() {
        return notes;
    }
    if !doc.parts.iter().any(|p| SOURCES.contains(&p.kind.as_str()) || is_gate(&p.kind)) {
        notes.push(DoctorNote::new(NoteLevel::Info, "doc.noSource", vec![]));
    }
    if let (false, Some(pi)) = (net.has_ground, net.auto_ground_part) {
        notes.push(DoctorNote::new(NoteLevel::Info, "doc.noGround", vec![doc.parts[pi].id.clone()]));
    }

    for (pi, p) in doc.parts.iter().enumerate() {
        let def = cat.def(&p.kind);
        let nodes = &net.pin_nodes[pi];
        let at = |n: i32| (n + 1) as usize;

        if POWER.contains(&p.kind.as_str()) && nodes.len() >= 2 && nodes[0] == nodes[1] {
            notes.push(DoctorNote::new(NoteLevel::Error, "doc.sourceShorted", vec![p.id.clone()]));
        }

        for (i, &n) in nodes.iter().enumerate() {
            let lonely = net.node_pins[at(n)].len() == 1;
            if !lonely {
                continue;
            }
            if p.kind == "ground" || p.kind == "probe" || def.optional.contains(&i) {
                continue;
            }
            if is_gate(&p.kind) && i + 1 < def.pins.len() {
                notes.push(DoctorNote::new(NoteLevel::Warn, "doc.gateInput", vec![p.id.clone()]));
            } else {
                let mut note = DoctorNote::new(NoteLevel::Warn, "doc.openPin", vec![p.id.clone()]);
                note.vars.push(("pin", i.to_string()));
                notes.push(note);
            }
        }

        if p.kind == "voltmeter" && nodes.len() == 2 {
            let others: Vec<Vec<usize>> = nodes.iter().map(|&n| net.node_pins[at(n)].iter().filter(|q| q.part != pi).map(|q| q.part).collect()).collect();
            if others.iter().all(|o| o.len() == 1) && others[0][0] != others[1][0] {
                let touches_ground = others.iter().any(|o| doc.parts[o[0]].kind == "ground");
                if !touches_ground {
                    notes.push(DoctorNote::new(NoteLevel::Warn, "doc.voltmeterSeries", vec![p.id.clone()]));
                }
            }
        }
    }
    notes
}
