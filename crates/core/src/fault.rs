//! Hidden faults for repair challenges: a part that looks normal on the board but is open
//! (broken inside) or shorted. Set with the hidden parameter `_fault` = "open" | "short".
//! The engine handles faults itself, so every part type can be faulty without changing its model.

use crate::doc::{Params, ParamsExt};
use crate::netlist::Node;
use crate::stamp::{AcStamper, Stamper};

/// Conductance of a shorted part (1 mΩ), the same as a closed switch.
const SHORT_G: f64 = 1e3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Fault {
    #[default]
    None,
    /// No connection through the part, like a burnt filament or a cracked resistor.
    Open,
    /// The first two pins are joined, like a punctured capacitor.
    Short,
}

impl Fault {
    pub fn from_params(p: &Params) -> Self {
        match p.text("_fault").as_str() {
            "open" => Fault::Open,
            "short" => Fault::Short,
            _ => Fault::None,
        }
    }

    pub fn stamp(self, s: &mut Stamper, nodes: &[Node]) {
        if self == Fault::Short && nodes.len() >= 2 {
            s.g(nodes[0], nodes[1], SHORT_G);
        }
    }

    pub fn accept(self, x: &[f64], nodes: &[Node], cur: &mut [f64]) {
        cur.fill(0.0);
        if self == Fault::Short && nodes.len() >= 2 {
            let v = |n: Node| if n < 0 { 0.0 } else { x[n as usize] };
            let i = (v(nodes[0]) - v(nodes[1])) * SHORT_G;
            cur[0] = i;
            cur[1] = -i;
        }
    }

    pub fn ac(self, s: &mut AcStamper, nodes: &[Node]) {
        if self == Fault::Short && nodes.len() >= 2 {
            s.yr(nodes[0], nodes[1], SHORT_G);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::builder::{Builder, num};
    use crate::doc::ParamValue;
    use crate::engine::Engine;

    fn divider(fault: &str) -> (Engine, String) {
        let mut b = Builder::new("");
        b.add("battery", 0.0, 0.0, 0, &[("V", num(10.0)), ("r", num(0.001))]);
        b.add("ground", 0.0, 40.0, 0, &[]);
        b.add("resistor", 100.0, -40.0, 0, &[("R", num(1000.0))]);
        let r2 = b.add("resistor", 140.0, 0.0, 1, &[("R", num(1000.0)), ("_fault", ParamValue::Text(fault.into()))]);
        b.path(&[(0.0, -40.0), (60.0, -40.0)]);
        b.path(&[(0.0, 40.0), (140.0, 40.0)]);
        let doc = b.done();
        (Engine::from_doc(&doc), r2)
    }

    fn mid(e: &mut Engine, r2: &str) -> f64 {
        e.run(10, None);
        e.reading(r2).unwrap().v
    }

    #[test]
    fn open_and_short_faults_change_the_divider() {
        let (mut e, r2) = divider("");
        assert!((mid(&mut e, &r2) - 5.0).abs() < 0.01);
        let (mut e, r2) = divider("open");
        assert!((mid(&mut e, &r2) - 10.0).abs() < 0.01, "open R2 takes the whole supply");
        let (mut e, r2) = divider("short");
        assert!(mid(&mut e, &r2).abs() < 0.02, "shorted R2 has no voltage");
        // Repairing it (clearing the fault) brings the circuit back.
        e.set_param(&r2, "_fault", ParamValue::Text(String::new()));
        assert!((mid(&mut e, &r2) - 5.0).abs() < 0.01);
    }
}
