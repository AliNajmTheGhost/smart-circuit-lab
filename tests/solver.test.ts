import { describe, expect, it } from 'vitest';
import { LuSolver, solve } from '../src/sim/stamper';

describe('LU solver', () => {
  const n = 6;
  const A = Float64Array.from({ length: n * n }, (_, i) => ((i * 7919) % 13) - 6 + (i % (n + 1) === 0 ? 20 : 0));
  const b = Float64Array.from({ length: n }, (_, i) => i + 1);
  const expected = (() => {
    const a = A.slice();
    const x = b.slice();
    solve(a, x, n);
    return [...x];
  })();

  it('matches Gaussian elimination', () => {
    const x = b.slice();
    expect(new LuSolver(n).solve(A, x)).toBe(true);
    x.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  it('reuses the factorisation when the matrix has not changed', () => {
    const lu = new LuSolver(n);
    const x1 = b.slice();
    const x2 = b.slice();
    lu.solve(A, x1);
    lu.solve(A, x2);
    expect(lu.reused).toBe(1);
    x2.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });
});
