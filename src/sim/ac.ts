/**
 * Complex nodal equations for small-signal frequency analysis (the Bode plotter).
 * Each component adds its admittance at angular frequency ω around the present operating point.
 */
export class AcStamper {
  readonly Gr: Float64Array;
  readonly Gi: Float64Array;
  readonly br: Float64Array;
  readonly bi: Float64Array;
  constructor(
    readonly n: number,
    /** Id of the source that drives the circuit with 1 V; every other source is switched off. */
    readonly stimulus: string,
  ) {
    this.Gr = new Float64Array(n * n);
    this.Gi = new Float64Array(n * n);
    this.br = new Float64Array(n);
    this.bi = new Float64Array(n);
  }

  /** Admittance re + j·im between nodes a and b. */
  y(a: number, b: number, re: number, im = 0): void {
    const n = this.n;
    if (a >= 0) {
      this.Gr[a * n + a] += re;
      this.Gi[a * n + a] += im;
    }
    if (b >= 0) {
      this.Gr[b * n + b] += re;
      this.Gi[b * n + b] += im;
    }
    if (a >= 0 && b >= 0) {
      this.Gr[a * n + b] -= re;
      this.Gi[a * n + b] -= im;
      this.Gr[b * n + a] -= re;
      this.Gi[b * n + a] -= im;
    }
  }

  /** Current into the device at `row` changes by (re + j·im)·(v_pos − v_neg). */
  trans(row: number, pos: number, neg: number, re: number, im = 0): void {
    if (row < 0) return;
    const n = this.n;
    if (pos >= 0) {
      this.Gr[row * n + pos] += re;
      this.Gi[row * n + pos] += im;
    }
    if (neg >= 0) {
      this.Gr[row * n + neg] -= re;
      this.Gi[row * n + neg] -= im;
    }
  }

  /** A current source pushing `re` amps from node a to node b through the device. */
  flow(a: number, b: number, re: number): void {
    if (a >= 0) this.br[a] -= re;
    if (b >= 0) this.br[b] += re;
  }
}

/** Complex Gaussian elimination. On success br/bi hold the node voltages. */
export function solveComplex(s: AcStamper): boolean {
  const { n, Gr, Gi, br, bi } = s;
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Gr[k * n + k] ** 2 + Gi[k * n + k] ** 2;
    for (let i = k + 1; i < n; i++) {
      const m = Gr[i * n + k] ** 2 + Gi[i * n + k] ** 2;
      if (m > max) {
        max = m;
        piv = i;
      }
    }
    if (max < 1e-40) return false;
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        let t = Gr[k * n + j];
        Gr[k * n + j] = Gr[piv * n + j];
        Gr[piv * n + j] = t;
        t = Gi[k * n + j];
        Gi[k * n + j] = Gi[piv * n + j];
        Gi[piv * n + j] = t;
      }
      let t = br[k];
      br[k] = br[piv];
      br[piv] = t;
      t = bi[k];
      bi[k] = bi[piv];
      bi[piv] = t;
    }
    const ar = Gr[k * n + k];
    const ai = Gi[k * n + k];
    const den = ar * ar + ai * ai;
    for (let i = k + 1; i < n; i++) {
      const xr = Gr[i * n + k];
      const xi = Gi[i * n + k];
      if (xr === 0 && xi === 0) continue;
      // f = x / a
      const fr = (xr * ar + xi * ai) / den;
      const fi = (xi * ar - xr * ai) / den;
      for (let j = k; j < n; j++) {
        const yr = Gr[k * n + j];
        const yi = Gi[k * n + j];
        Gr[i * n + j] -= fr * yr - fi * yi;
        Gi[i * n + j] -= fr * yi + fi * yr;
      }
      br[i] -= fr * br[k] - fi * bi[k];
      bi[i] -= fr * bi[k] + fi * br[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i];
    let si = bi[i];
    for (let j = i + 1; j < n; j++) {
      const gr = Gr[i * n + j];
      const gi = Gi[i * n + j];
      sr -= gr * br[j] - gi * bi[j];
      si -= gr * bi[j] + gi * br[j];
    }
    const ar = Gr[i * n + i];
    const ai = Gi[i * n + i];
    const den = ar * ar + ai * ai;
    br[i] = (sr * ar + si * ai) / den;
    bi[i] = (si * ar - sr * ai) / den;
  }
  return true;
}
