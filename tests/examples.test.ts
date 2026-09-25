import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { staticChecks } from '../src/sim/doctor';
import { Engine } from '../src/sim/engine';

describe('examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: every pin is wired and it simulates cleanly`, () => {
      const doc = ex.build();
      const e = new Engine(doc);
      const notes = staticChecks(doc, e.net).filter((n) => n.level !== 'info');
      expect(notes.map((n) => `${n.key} ${doc.parts.find((p) => p.id === n.parts[0])?.label}`)).toEqual([]);
      for (let i = 0; i < 3000; i++) {
        const damaged = e.step();
        expect(damaged.map((d) => d.key)).toEqual([]);
      }
      expect(e.failure).toBeNull();
    });
  }

  it('common-emitter amplifier has a sensible bias point and gain', () => {
    const doc = EXAMPLES.find((x) => x.id === 'ce-amp')!.build();
    const e = new Engine(doc);
    const q = doc.parts.find((p) => p.type === 'npn')!;
    const out = doc.parts.find((p) => p.type === 'probe' && p.params.ch === '2')!;
    // Let the coupling and bypass capacitors settle.
    for (let i = 0; i < 60000; i++) e.step();
    const vce = e.byId.get(q.id)!.extra().vce;
    expect(vce).toBeGreaterThan(4);
    expect(vce).toBeLessThan(8);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 200; i++) {
      e.step();
      const v = e.byId.get(out.id)!.extra().v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const gain = (hi - lo) / 0.02;
    expect(gain).toBeGreaterThan(50);
  });

  it('bridge rectifier output never goes negative', () => {
    const doc = EXAMPLES.find((x) => x.id === 'bridge')!.build();
    const e = new Engine(doc, 2e-5);
    const out = doc.parts.find((p) => p.type === 'probe')!;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      e.step();
      const v = e.byId.get(out.id)!.extra().v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThan(-0.05);
    expect(max).toBeGreaterThan(10);
  });
});
