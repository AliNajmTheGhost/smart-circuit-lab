/**
 * Builds the nodal equations G·v = i.
 * Every component "stamps" its contribution; node -1 is ground and is skipped.
 */
export class Stamper {
  readonly G: Float64Array;
  readonly b: Float64Array;
  constructor(readonly n: number) {
    this.G = new Float64Array(n * n);
    this.b = new Float64Array(n);
  }

  clear(): void {
    this.G.fill(0);
    this.b.fill(0);
  }

  /** A conductance g between nodes a and c. */
  g(a: number, c: number, g: number): void {
    const n = this.n;
    if (a >= 0) this.G[a * n + a] += g;
    if (c >= 0) this.G[c * n + c] += g;
    if (a >= 0 && c >= 0) {
      this.G[a * n + c] -= g;
      this.G[c * n + a] -= g;
    }
  }

  /** A fixed current i flowing through the component from node a to node c. */
  flow(a: number, c: number, i: number): void {
    if (a >= 0) this.b[a] -= i;
    if (c >= 0) this.b[c] += i;
  }

  /**
   * Linearised multi-terminal device (diodes, transistors).
   * I0[k]: current into terminal k at the operating point.
   * ctrl[j] = [pos, neg, v0]: controlling voltage j and its value at the operating point.
   * dI[k][j]: ∂I_k / ∂v_j.
   */
  lin(nodes: number[], I0: number[], ctrl: [number, number, number][], dI: number[][]): void {
    const n = this.n;
    for (let k = 0; k < nodes.length; k++) {
      const row = nodes[k];
      if (row < 0) continue;
      let rhs = I0[k];
      for (let j = 0; j < ctrl.length; j++) {
        const g = dI[k][j];
        if (g === 0) continue;
        const [pos, neg, v0] = ctrl[j];
        if (pos >= 0) this.G[row * n + pos] += g;
        if (neg >= 0) this.G[row * n + neg] -= g;
        rhs -= g * v0;
      }
      this.b[row] -= rhs;
    }
  }
}

/**
 * Solves A·x = b in place by Gaussian elimination with partial pivoting.
 * On success b holds x. Returns false when the matrix is singular.
 */
export function solve(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let piv = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) {
        max = v;
        piv = i;
      }
    }
    if (max < 1e-20) return false;
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j];
        A[k * n + j] = A[piv * n + j];
        A[piv * n + j] = t;
      }
      const t = b[k];
      b[k] = b[piv];
      b[piv] = t;
    }
    const akk = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / akk;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
    b[i] = s / A[i * n + i];
  }
  return true;
}
