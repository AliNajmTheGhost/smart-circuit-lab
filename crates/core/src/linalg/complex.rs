//! Complex Gaussian elimination for the small-signal (Bode) equations.
//! Real and imaginary parts are kept in separate arrays so the stamps stay simple.

/// Solves `(Gr + j·Gi)·x = br + j·bi` in place. On success `br`/`bi` hold the node voltages.
pub fn solve_complex(gr: &mut [f64], gi: &mut [f64], br: &mut [f64], bi: &mut [f64], n: usize) -> bool {
    for k in 0..n {
        let mut piv = k;
        let mut max = gr[k * n + k].powi(2) + gi[k * n + k].powi(2);
        for i in k + 1..n {
            let m = gr[i * n + k].powi(2) + gi[i * n + k].powi(2);
            if m > max {
                max = m;
                piv = i;
            }
        }
        if max < 1e-40 {
            return false;
        }
        if piv != k {
            for j in 0..n {
                gr.swap(k * n + j, piv * n + j);
                gi.swap(k * n + j, piv * n + j);
            }
            br.swap(k, piv);
            bi.swap(k, piv);
        }
        let ar = gr[k * n + k];
        let ai = gi[k * n + k];
        let den = ar * ar + ai * ai;
        for i in k + 1..n {
            let xr = gr[i * n + k];
            let xi = gi[i * n + k];
            if xr == 0.0 && xi == 0.0 {
                continue;
            }
            // f = x / a
            let fr = (xr * ar + xi * ai) / den;
            let fi = (xi * ar - xr * ai) / den;
            for j in k..n {
                let yr = gr[k * n + j];
                let yi = gi[k * n + j];
                gr[i * n + j] -= fr * yr - fi * yi;
                gi[i * n + j] -= fr * yi + fi * yr;
            }
            br[i] -= fr * br[k] - fi * bi[k];
            bi[i] -= fr * bi[k] + fi * br[k];
        }
    }
    for i in (0..n).rev() {
        let mut sr = br[i];
        let mut si = bi[i];
        for j in i + 1..n {
            let (g_r, g_i) = (gr[i * n + j], gi[i * n + j]);
            sr -= g_r * br[j] - g_i * bi[j];
            si -= g_r * bi[j] + g_i * br[j];
        }
        let ar = gr[i * n + i];
        let ai = gi[i * n + i];
        let den = ar * ar + ai * ai;
        br[i] = (sr * ar + si * ai) / den;
        bi[i] = (si * ar - sr * ai) / den;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solves_a_complex_system() {
        // (1+j)x = 2  →  x = 1 - j
        let (mut gr, mut gi, mut br, mut bi) = (vec![1.0], vec![1.0], vec![2.0], vec![0.0]);
        assert!(solve_complex(&mut gr, &mut gi, &mut br, &mut bi, 1));
        assert!((br[0] - 1.0).abs() < 1e-12 && (bi[0] + 1.0).abs() < 1e-12);
    }
}
