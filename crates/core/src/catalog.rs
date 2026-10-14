//! Electrical facts about every part type: pin positions, parameter defaults, hidden nodes.
//! The data comes from `catalog/parts.json`, which is exported from the interface's part library,
//! so the drawing and the simulator always agree on where each pin is.

use crate::doc::{ParamValue, Params, Part, Pt};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
pub struct PinDef {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize)]
pub struct ParamDef {
    pub key: String,
    pub def: ParamValue,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartDef {
    #[serde(rename = "type")]
    pub kind: String,
    pub pins: Vec<PinDef>,
    pub params: Vec<ParamDef>,
    /// Pins that may be left unconnected without a warning (e.g. 555 RESET and CTRL).
    pub optional: Vec<usize>,
    /// Extra hidden nodes the simulator needs inside the part (e.g. LED + resistor per segment).
    pub internal_nodes: usize,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    parts: Vec<PartDef>,
}

pub struct Catalog {
    parts: Vec<PartDef>,
    by_kind: HashMap<String, usize>,
}

/// A part type with no pins, used when a document names a type this version does not know.
static UNKNOWN: PartDef = PartDef { kind: String::new(), pins: Vec::new(), params: Vec::new(), optional: Vec::new(), internal_nodes: 0 };

impl Catalog {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        let file: CatalogFile = serde_json::from_str(s)?;
        let by_kind = file.parts.iter().enumerate().map(|(i, d)| (d.kind.clone(), i)).collect();
        Ok(Self { parts: file.parts, by_kind })
    }

    pub fn get(&self, kind: &str) -> Option<&PartDef> {
        self.by_kind.get(kind).map(|&i| &self.parts[i])
    }

    /// The definition, or an empty one (no pins) for unknown types so old files still open.
    pub fn def(&self, kind: &str) -> &PartDef {
        self.get(kind).unwrap_or(&UNKNOWN)
    }

    pub fn parts(&self) -> &[PartDef] {
        &self.parts
    }

    pub fn default_params(&self, kind: &str) -> Params {
        self.def(kind).params.iter().map(|p| (p.key.clone(), p.def.clone())).collect()
    }

    /// Where pin `i` of a placed part is on the board.
    pub fn pin_world(&self, part: &Part, i: usize) -> Pt {
        let pin = &self.def(&part.kind).pins[i];
        let y = if part.flip { -pin.y } else { pin.y };
        let r = rotate(Pt::new(pin.x, y), part.rot);
        Pt::new(part.x + r.x, part.y + r.y)
    }

    pub fn pin_count(&self, kind: &str) -> usize {
        self.def(kind).pins.len()
    }
}

/// The built-in catalog shipped with this version.
pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| Catalog::from_json(include_str!("../../../catalog/parts.json")).expect("catalog/parts.json is valid"))
}

/// Rotate a local point by quarter turns clockwise (screen coordinates, y down).
pub fn rotate(p: Pt, rot: i32) -> Pt {
    match rot.rem_euclid(4) {
        1 => Pt::new(-p.y, p.x),
        2 => Pt::new(-p.x, -p.y),
        3 => Pt::new(p.y, -p.x),
        _ => p,
    }
}

pub const GATE_KINDS: [&str; 7] = ["and", "or", "not", "nand", "nor", "xor", "xnor"];

pub fn is_gate(kind: &str) -> bool {
    GATE_KINDS.contains(&kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_loads_every_part() {
        let c = catalog();
        assert!(c.parts().len() > 50);
        assert_eq!(c.pin_count("resistor"), 2);
        assert_eq!(c.pin_count("timer555"), 8);
        assert_eq!(c.def("sevenseg").internal_nodes, 7);
        assert_eq!(c.pin_count("no-such-part"), 0);
    }
}
