import { describe, expect, it } from 'vitest';
import { buildChallenge, CHALLENGES, faultyPart } from '../src/challenges/challenges';
import type { CircuitDoc } from '../src/model/types';
import { Engine, ENGINE_KIND } from './engine';

/**
 * A fingerprint of how the circuit behaves: the average size of every node voltage and every
 * part's current over the second half of the run (averages, so AC circuits are not caught at a zero crossing).
 */
function behaviour(doc: CircuitDoc, steps: number): number[] {
  const e = new Engine(doc, 1e-5);
  let acc: number[] = [];
  let samples = 0;
  for (let i = 0; i < steps; i++) {
    e.step();
    if (i < steps / 2 || i % 20) continue;
    const now = [...e.x, ...e.devices.map((d) => d.cur[0] ?? 0)].map(Math.abs);
    acc = now.map((v, k) => (acc[k] ?? 0) + v);
    samples++;
  }
  expect(e.failure).toBeNull();
  return acc.map((v) => v / samples);
}

// Hidden faults are handled by the Rust engine only.
describe.skipIf(ENGINE_KIND === 'ts')('repair challenges', () => {
  for (const c of CHALLENGES) {
    it(`${c.id}: the fault is visible in the circuit and repairing it fixes it`, () => {
      const doc = buildChallenge(c);
      const id = faultyPart(doc);
      expect(id, `no part labelled ${c.fault.label}`).toBeDefined();
      const broken = behaviour(doc, 6000);
      const fixed = structuredClone(doc);
      delete fixed.parts.find((p) => p.id === id)!.params._fault;
      const healthy = behaviour(fixed, 6000);
      // Some voltage or current changes by more than 20 % of itself (and is not just noise).
      const changed = healthy.some((v, i) => Math.abs(v - broken[i]) > 0.2 * Math.max(v, broken[i]) && Math.max(v, broken[i]) > 1e-4);
      expect(changed).toBe(true);
    });
  }

  it('the weak amplifier really has a low gain until the bypass capacitor is replaced', () => {
    const gain = (doc: CircuitDoc) => {
      const e = new Engine(doc, 1e-5);
      const out = doc.parts.find((p) => p.type === 'probe' && p.params.ch === '2')!.id;
      for (let i = 0; i < 60000; i++) e.step();
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 200; i++) {
        e.step();
        const v = e.byId.get(out)!.extra().v;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return (hi - lo) / 0.02;
    };
    const doc = buildChallenge(CHALLENGES.find((c) => c.id === 'ce-bypass-open')!);
    expect(gain(doc)).toBeLessThan(10);
    delete doc.parts.find((p) => p.label === 'C1')!.params._fault;
    expect(gain(doc)).toBeGreaterThan(50);
  });
});
