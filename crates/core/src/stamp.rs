//! Building the nodal equations. Every part "stamps" its contribution; ground rows are skipped.

use crate::netlist::Node;

/// Real equations `G·v = b` for one Newton iteration of the transient analysis.
pub struct Stamper {
    pub n: usize,
    /// Row-major n×n conductance matrix.
    pub g: Vec<f64>,
    pub b: Vec<f64>,
}

impl Stamper {
    pub fn new(n: usize) -> Self {
        Self { n, g: vec![0.0; n * n], b: vec![0.0; n] }
    }

    pub fn clear(&mut self) {
        self.g.fill(0.0);
        self.b.fill(0.0);
    }

    #[inline]
    fn at(&mut self, row: Node, col: Node) -> &mut f64 {
        &mut self.g[row as usize * self.n + col as usize]
    }

    /// A conductance `g` between nodes `a` and `c`.
    #[inline]
    pub fn g(&mut self, a: Node, c: Node, g: f64) {
        if a >= 0 {
            *self.at(a, a) += g;
        }
        if c >= 0 {
            *self.at(c, c) += g;
        }
        if a >= 0 && c >= 0 {
            *self.at(a, c) -= g;
            *self.at(c, a) -= g;
        }
    }

    /// A fixed current `i` flowing through the part from node `a` to node `c`.
    #[inline]
    pub fn flow(&mut self, a: Node, c: Node, i: f64) {
        if a >= 0 {
            self.b[a as usize] -= i;
        }
        if c >= 0 {
            self.b[c as usize] += i;
        }
    }

    /// Linearised multi-terminal device (diodes, transistors, op-amps).
    /// `i0[k]`: current into terminal k at the operating point.
    /// `ctrl[j] = (pos, neg, v0)`: controlling voltage j and its value at the operating point.
    /// `di[k][j]`: ∂I_k / ∂v_j.
    #[inline]
    pub fn lin<const K: usize, const J: usize>(&mut self, nodes: [Node; K], i0: [f64; K], ctrl: [(Node, Node, f64); J], di: [[f64; J]; K]) {
        for k in 0..K {
            let row = nodes[k];
            if row < 0 {
                continue;
            }
            let mut rhs = i0[k];
            for j in 0..J {
                let g = di[k][j];
                if g == 0.0 {
                    continue;
                }
                let (pos, neg, v0) = ctrl[j];
                if pos >= 0 {
                    *self.at(row, pos) += g;
                }
                if neg >= 0 {
                    *self.at(row, neg) -= g;
                }
                rhs -= g * v0;
            }
            self.b[row as usize] -= rhs;
        }
    }
}

/// Complex equations for small-signal frequency analysis (the Bode plotter).
/// Each part adds its admittance at angular frequency ω around the present operating point.
pub struct AcStamper {
    pub n: usize,
    pub gr: Vec<f64>,
    pub gi: Vec<f64>,
    pub br: Vec<f64>,
    pub bi: Vec<f64>,
    /// Index of the part that drives the circuit with 1 V; every other source is switched off.
    pub stimulus: usize,
}

impl AcStamper {
    pub fn new(n: usize, stimulus: usize) -> Self {
        Self { n, gr: vec![0.0; n * n], gi: vec![0.0; n * n], br: vec![0.0; n], bi: vec![0.0; n], stimulus }
    }

    pub fn clear(&mut self) {
        self.gr.fill(0.0);
        self.gi.fill(0.0);
        self.br.fill(0.0);
        self.bi.fill(0.0);
    }

    #[inline]
    fn add(&mut self, row: Node, col: Node, re: f64, im: f64) {
        let i = row as usize * self.n + col as usize;
        self.gr[i] += re;
        self.gi[i] += im;
    }

    /// Admittance `re + j·im` between nodes `a` and `b`.
    #[inline]
    pub fn y(&mut self, a: Node, b: Node, re: f64, im: f64) {
        if a >= 0 {
            self.add(a, a, re, im);
        }
        if b >= 0 {
            self.add(b, b, re, im);
        }
        if a >= 0 && b >= 0 {
            self.add(a, b, -re, -im);
            self.add(b, a, -re, -im);
        }
    }

    /// Real admittance between `a` and `b`.
    #[inline]
    pub fn yr(&mut self, a: Node, b: Node, re: f64) {
        self.y(a, b, re, 0.0);
    }

    /// Current into the device at `row` changes by `(re + j·im)·(v_pos − v_neg)`.
    #[inline]
    pub fn trans(&mut self, row: Node, pos: Node, neg: Node, re: f64, im: f64) {
        if row < 0 {
            return;
        }
        if pos >= 0 {
            self.add(row, pos, re, im);
        }
        if neg >= 0 {
            self.add(row, neg, -re, -im);
        }
    }

    /// A current source pushing `re` amps from node `a` to node `b` through the device.
    #[inline]
    pub fn flow(&mut self, a: Node, b: Node, re: f64) {
        if a >= 0 {
            self.br[a as usize] -= re;
        }
        if b >= 0 {
            self.br[b as usize] += re;
        }
    }
}
