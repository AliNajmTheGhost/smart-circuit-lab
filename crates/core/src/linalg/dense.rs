//! Dense LU factorisation with partial pivoting, for the real nodal equations.

/// Pivots smaller than this mean the circuit has a floating or shorted part.
const SINGULAR: f64 = 1e-20;

/// Solves `A·x = b` in place by Gaussian elimination with partial pivoting (`A` is row-major n×n).
/// On success `b` holds `x`. Returns false when the matrix is singular.
pub fn solve(a: &mut [f64], b: &mut [f64], n: usize) -> bool {
    for k in 0..n {
        let mut piv = k;
        let mut max = a[k * n + k].abs();
        for i in k + 1..n {
            let v = a[i * n + k].abs();
            if v > max {
                max = v;
                piv = i;
            }
        }
        if max < SINGULAR {
            return false;
        }
        if piv != k {
            for j in 0..n {
                a.swap(k * n + j, piv * n + j);
            }
            b.swap(k, piv);
        }
        let akk = a[k * n + k];
        for i in k + 1..n {
            let f = a[i * n + k] / akk;
            if f == 0.0 {
                continue;
            }
            for j in k..n {
                a[i * n + j] -= f * a[k * n + j];
            }
            b[i] -= f * b[k];
        }
    }
    for i in (0..n).rev() {
        let mut s = b[i];
        for j in i + 1..n {
            s -= a[i * n + j] * b[j];
        }
        b[i] = s / a[i * n + i];
    }
    true
}

/// LU solver that remembers its last factorisation. In a linear circuit with a fixed time step
/// the matrix is the same every step, so only the cheap substitution (n²) runs instead of a
/// full elimination (n³).
pub struct LuSolver {
    n: usize,
    lu: Vec<f64>,
    key: Vec<f64>,
    perm: Vec<usize>,
    tmp: Vec<f64>,
    valid: bool,
    /// How many solves reused the stored factorisation (for tests and tuning).
    pub reused: u64,
    pub factored: u64,
}

impl LuSolver {
    pub fn new(n: usize) -> Self {
        Self { n, lu: vec![0.0; n * n], key: vec![0.0; n * n], perm: (0..n).collect(), tmp: vec![0.0; n], valid: false, reused: 0, factored: 0 }
    }

    /// Solves `A·x = b`. On success `b` holds `x`; `A` is left untouched.
    pub fn solve(&mut self, a: &[f64], b: &mut [f64]) -> bool {
        if self.valid && a == self.key.as_slice() {
            self.reused += 1;
        } else if !self.factor(a) {
            return false;
        }
        self.substitute(b);
        true
    }

    /// Forget the stored factorisation (after the matrix changes shape or meaning).
    pub fn invalidate(&mut self) {
        self.valid = false;
    }

    fn factor(&mut self, a: &[f64]) -> bool {
        let n = self.n;
        self.factored += 1;
        self.key.copy_from_slice(a);
        self.lu.copy_from_slice(a);
        let lu = &mut self.lu;
        for (i, p) in self.perm.iter_mut().enumerate() {
            *p = i;
        }
        for k in 0..n {
            let mut piv = k;
            let mut max = lu[k * n + k].abs();
            for i in k + 1..n {
                let v = lu[i * n + k].abs();
                if v > max {
                    max = v;
                    piv = i;
                }
            }
            if max < SINGULAR {
                self.valid = false;
                return false;
            }
            if piv != k {
                for j in 0..n {
                    lu.swap(k * n + j, piv * n + j);
                }
                self.perm.swap(k, piv);
            }
            let akk = lu[k * n + k];
            let (top, rest) = lu.split_at_mut((k + 1) * n);
            let row_k = &top[k * n..];
            for row_i in rest.chunks_exact_mut(n) {
                let f = row_i[k] / akk;
                row_i[k] = f;
                if f == 0.0 {
                    continue;
                }
                for j in k + 1..n {
                    row_i[j] -= f * row_k[j];
                }
            }
        }
        self.valid = true;
        true
    }

    fn substitute(&mut self, b: &mut [f64]) {
        let n = self.n;
        let (lu, tmp) = (&self.lu, &mut self.tmp);
        for i in 0..n {
            tmp[i] = b[self.perm[i]];
        }
        for i in 1..n {
            let row = &lu[i * n..i * n + i];
            let mut s = tmp[i];
            for (j, l) in row.iter().enumerate() {
                s -= l * tmp[j];
            }
            tmp[i] = s;
        }
        for i in (0..n).rev() {
            let mut s = tmp[i];
            for j in i + 1..n {
                s -= lu[i * n + j] * tmp[j];
            }
            tmp[i] = s / lu[i * n + i];
        }
        b.copy_from_slice(tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(n: usize) -> (Vec<f64>, Vec<f64>) {
        let a = (0..n * n).map(|i| ((i * 7919) % 13) as f64 - 6.0 + if i % (n + 1) == 0 { 20.0 } else { 0.0 }).collect();
        let b = (0..n).map(|i| i as f64 + 1.0).collect();
        (a, b)
    }

    #[test]
    fn lu_matches_gaussian_elimination() {
        let n = 6;
        let (a, b) = sample(n);
        let mut expected = b.clone();
        assert!(solve(&mut a.clone(), &mut expected, n));
        let mut lu = LuSolver::new(n);
        let mut x = b.clone();
        assert!(lu.solve(&a, &mut x));
        for (u, v) in x.iter().zip(&expected) {
            assert!((u - v).abs() < 1e-10);
        }
        // Same matrix again: the factorisation is reused.
        let mut x2 = b.clone();
        assert!(lu.solve(&a, &mut x2));
        assert_eq!(lu.reused, 1);
        assert_eq!(x, x2);
    }

    #[test]
    fn singular_matrix_is_reported() {
        let a = vec![1.0, 2.0, 2.0, 4.0];
        let mut b = vec![1.0, 2.0];
        assert!(!LuSolver::new(2).solve(&a, &mut b));
    }
}
