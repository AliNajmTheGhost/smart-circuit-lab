//! Turns the drawing into electrical nodes.
//! Node -1 is the 0 V reference (ground); the others are numbered 0..node_count.

use crate::catalog::catalog;
use crate::doc::{CircuitDoc, PointKey};
use std::collections::HashMap;

/// Index of an electrical node; [`GND`] is the reference.
pub type Node = i32;
pub const GND: Node = -1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinRef {
    /// Index of the part in `doc.parts`.
    pub part: usize,
    pub pin: usize,
}

#[derive(Debug, Clone)]
pub struct Netlist {
    pub node_count: usize,
    /// Node of every pin, per part (same order as `doc.parts`).
    pub pin_nodes: Vec<Vec<Node>>,
    /// Node of every point that has a pin or a wire end.
    pub point_node: HashMap<PointKey, Node>,
    /// Pins attached to each node (index node + 1, so ground is at 0).
    pub node_pins: Vec<Vec<PinRef>>,
    /// Number of wire ends at each node (same indexing).
    pub node_wire_ends: Vec<u32>,
    /// True when a ground symbol is on the board.
    pub has_ground: bool,
    /// When there is no ground symbol, the part whose negative pin was used as 0 V.
    pub auto_ground_part: Option<usize>,
    flow: WireFlowPlan,
}

/// Union-find over board points that remembers the order points were first seen,
/// so node numbers are stable and match the interface's numbering.
struct UnionFind {
    index: HashMap<PointKey, usize>,
    keys: Vec<PointKey>,
    parent: Vec<usize>,
}

impl UnionFind {
    fn new() -> Self {
        Self { index: HashMap::new(), keys: Vec::new(), parent: Vec::new() }
    }

    fn id(&mut self, k: PointKey) -> usize {
        if let Some(&i) = self.index.get(&k) {
            return i;
        }
        let i = self.keys.len();
        self.index.insert(k, i);
        self.keys.push(k);
        self.parent.push(i);
        i
    }

    fn find(&mut self, k: PointKey) -> usize {
        let i = self.id(k);
        self.root(i)
    }

    fn root(&mut self, i: usize) -> usize {
        let mut r = i;
        while self.parent[r] != r {
            r = self.parent[r];
        }
        let mut c = i;
        while c != r {
            let next = self.parent[c];
            self.parent[c] = r;
            c = next;
        }
        r
    }

    fn union(&mut self, a: PointKey, b: PointKey) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            self.parent[ra] = rb;
        }
    }
}

/// Which pin of each source is its negative terminal, used as 0 V when there is no ground symbol.
fn negative_pin(kind: &str) -> Option<usize> {
    matches!(kind, "battery" | "psu" | "ac" | "funcgen").then_some(1)
}

pub fn build_netlist(doc: &CircuitDoc) -> Netlist {
    let cat = catalog();
    let mut uf = UnionFind::new();
    for w in &doc.wires {
        uf.union(w.a.key(), w.b.key());
    }
    let pin_keys: Vec<Vec<PointKey>> = doc
        .parts
        .iter()
        .map(|p| {
            (0..cat.pin_count(&p.kind))
                .map(|i| {
                    let k = cat.pin_world(p, i).key();
                    uf.find(k);
                    k
                })
                .collect()
        })
        .collect();

    // Which roots are 0 V? All ground symbols are the same node even if not wired together.
    let mut ground_roots: Vec<usize> = Vec::new();
    for (pi, p) in doc.parts.iter().enumerate() {
        if p.kind == "ground" {
            if let Some(&k) = pin_keys[pi].first() {
                let r = uf.find(k);
                if !ground_roots.contains(&r) {
                    ground_roots.push(r);
                }
            }
        }
    }
    let has_ground = !ground_roots.is_empty();
    let mut auto_ground_part = None;
    if !has_ground {
        if let Some((pi, neg)) = doc.parts.iter().enumerate().find_map(|(i, p)| negative_pin(&p.kind).map(|n| (i, n))) {
            auto_ground_part = Some(pi);
            ground_roots.push(uf.find(pin_keys[pi][neg]));
        }
    }

    let mut root_node: HashMap<usize, Node> = ground_roots.iter().map(|&r| (r, GND)).collect();
    let mut node_count = 0usize;
    let mut point_node = HashMap::with_capacity(uf.keys.len());
    for i in 0..uf.keys.len() {
        let r = uf.root(i);
        let n = *root_node.entry(r).or_insert_with(|| {
            node_count += 1;
            (node_count - 1) as Node
        });
        point_node.insert(uf.keys[i], n);
    }

    let mut node_pins = vec![Vec::new(); node_count + 1];
    let pin_nodes: Vec<Vec<Node>> = pin_keys
        .iter()
        .enumerate()
        .map(|(pi, keys)| {
            keys.iter()
                .enumerate()
                .map(|(pin, k)| {
                    let n = point_node[k];
                    node_pins[(n + 1) as usize].push(PinRef { part: pi, pin });
                    n
                })
                .collect()
        })
        .collect();
    let mut node_wire_ends = vec![0u32; node_count + 1];
    for w in &doc.wires {
        node_wire_ends[(point_node[&w.a.key()] + 1) as usize] += 1;
        node_wire_ends[(point_node[&w.b.key()] + 1) as usize] += 1;
    }

    Netlist { node_count, pin_nodes, point_node, node_pins, node_wire_ends, has_ground, auto_ground_part, flow: WireFlowPlan::new(doc) }
}

/// Precomputed spanning-tree walk over the wires, for finding the current in each wire.
#[derive(Debug, Clone, Default)]
struct WireFlowPlan {
    /// Points in breadth-first order.
    order: Vec<PointKey>,
    /// For each non-root point: the wire to its parent, whether the point is that wire's `a` end, and the parent.
    up: HashMap<PointKey, (usize, bool, PointKey)>,
}

impl WireFlowPlan {
    fn new(doc: &CircuitDoc) -> Self {
        // Adjacency in first-seen order, so the walk is the same every time.
        let mut adj_index: HashMap<PointKey, usize> = HashMap::new();
        let mut adj: Vec<(PointKey, Vec<(usize, PointKey, bool)>)> = Vec::new();
        let mut push = |k: PointKey, v: (usize, PointKey, bool)| {
            let i = *adj_index.entry(k).or_insert_with(|| {
                adj.push((k, Vec::new()));
                adj.len() - 1
            });
            adj[i].1.push(v);
        };
        for (wi, w) in doc.wires.iter().enumerate() {
            let (a, b) = (w.a.key(), w.b.key());
            push(a, (wi, b, false));
            push(b, (wi, a, true));
        }
        let mut plan = WireFlowPlan::default();
        let mut seen = std::collections::HashSet::new();
        let mut queue = std::collections::VecDeque::new();
        for (start, _) in &adj {
            if !seen.insert(*start) {
                continue;
            }
            queue.push_back(*start);
            while let Some(k) = queue.pop_front() {
                plan.order.push(k);
                for &(wire, other, is_a) in &adj[adj_index[&k]].1 {
                    if seen.insert(other) {
                        // `other` is the child; it is wire end `a` when k is end `b`.
                        plan.up.insert(other, (wire, is_a, k));
                        queue.push_back(other);
                    }
                }
            }
        }
        plan
    }
}

impl Netlist {
    /// Current in every wire (indexed like `doc.wires`), from the currents entering each pin.
    /// Positive means flowing from the wire's `a` end to its `b` end.
    /// Wires that close a loop inside one node carry no current here, which is fine for drawing.
    pub fn wire_currents(&self, doc: &CircuitDoc, pin_currents: &[&[f64]]) -> Vec<f64> {
        let cat = catalog();
        let mut sub: HashMap<PointKey, f64> = HashMap::new();
        for (pi, p) in doc.parts.iter().enumerate() {
            let cur = pin_currents.get(pi).copied().unwrap_or(&[]);
            for i in 0..cat.pin_count(&p.kind) {
                // Current flowing into a device pin leaves the wire network there.
                *sub.entry(cat.pin_world(p, i).key()).or_insert(0.0) -= cur.get(i).copied().unwrap_or(0.0);
            }
        }
        let mut out = vec![0.0; doc.wires.len()];
        for k in self.flow.order.iter().rev() {
            let Some(&(wire, is_a, parent)) = self.flow.up.get(k) else { continue };
            let s = sub.get(k).copied().unwrap_or(0.0);
            // s flows from this point toward its parent.
            out[wire] = if is_a { s } else { -s };
            *sub.entry(parent).or_insert(0.0) += s;
        }
        out
    }
}
