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

/**
 * LU solver that remembers its last factorisation. In a linear circuit with a fixed time step
 * the matrix is the same every step, so only the cheap substitution (n²) runs instead of a
 * full elimination (n³).
 */
export class LuSolver {
  private readonly lu: Float64Array;
  private readonly key: Float64Array;
  private readonly perm: Int32Array;
  private readonly tmp: Float64Array;
  private valid = false;
  /** How many solves reused the stored factorisation (for tests and tuning). */
  reused = 0;

  constructor(readonly n: number) {
    this.lu = new Float64Array(n * n);
    this.key = new Float64Array(n * n);
    this.perm = new Int32Array(n);
    this.tmp = new Float64Array(n);
  }

  /** Solves A·x = b. On success b holds x; A is left untouched. */
  solve(A: Float64Array, b: Float64Array): boolean {
    if (this.valid && same(A, this.key)) this.reused++;
    else if (!this.factor(A)) return false;
    this.substitute(b);
    return true;
  }

  private factor(A: Float64Array): boolean {
    const { n, lu, perm } = this;
    this.key.set(A);
    lu.set(A);
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let k = 0; k < n; k++) {
      let piv = k;
      let max = Math.abs(lu[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(lu[i * n + k]);
        if (v > max) {
          max = v;
          piv = i;
        }
      }
      if (max < 1e-20) {
        this.valid = false;
        return false;
      }
      if (piv !== k) {
        for (let j = 0; j < n; j++) {
          const t = lu[k * n + j];
          lu[k * n + j] = lu[piv * n + j];
          lu[piv * n + j] = t;
        }
        const t = perm[k];
        perm[k] = perm[piv];
        perm[piv] = t;
      }
      const akk = lu[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = lu[i * n + k] / akk;
        lu[i * n + k] = f;
        if (f === 0) continue;
        for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
      }
    }
    this.valid = true;
    return true;
  }

  private substitute(b: Float64Array): void {
    const { n, lu, perm, tmp } = this;
    for (let i = 0; i < n; i++) tmp[i] = b[perm[i]];
    for (let i = 1; i < n; i++) {
      let s = tmp[i];
      for (let j = 0; j < i; j++) s -= lu[i * n + j] * tmp[j];
      tmp[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = tmp[i];
      for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * tmp[j];
      tmp[i] = s / lu[i * n + i];
    }
    b.set(tmp);
  }
}

function same(a: Float64Array, b: Float64Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
