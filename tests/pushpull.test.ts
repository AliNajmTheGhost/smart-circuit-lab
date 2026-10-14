import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { Builder } from '../src/model/docops';
import { pinWorld } from '../src/model/library';
import { Engine, ENGINE_KIND } from './engine';

// The centre-tapped transformer exists only in the Rust engine.
describe.skipIf(ENGINE_KIND === 'ts')('centre-tapped transformer and push-pull amplifier', () => {
  it('a flipped transistor has its emitter on top', () => {
    const doc = EXAMPLES.find((x) => x.id === 'push-pull')!.build();
    const q2 = doc.parts.filter((p) => p.type === 'npn')[1];
    expect(q2.flip).toBe(true);
    expect(pinWorld(q2, 2).y).toBeLessThan(pinWorld(q2, 1).y);
  });

  it('each half of the secondary carries half the voltage, in opposite phase', () => {
    const b = new Builder();
    b.add('ac', 0, 0, 0, { Vp: 10, f: 50, r: 0.1 });
    b.add('ground', 0, 40);
    const t = b.add('ctransformer', 200, 0, 0, { n: 1 });
    b.add('resistor', 320, -40, 0, { R: 1000 });
    b.add('resistor', 320, 40, 0, { R: 1000 });
    b.add('ground', 240, 0);
    b.add('ground', 360, -40);
    b.add('ground', 360, 40);
    b.path({ x: 0, y: -40 }, { x: 160, y: -40 });
    b.path({ x: 0, y: 40 }, { x: 160, y: 40 });
    b.path({ x: 240, y: -40 }, { x: 280, y: -40 });
    b.path({ x: 240, y: 40 }, { x: 280, y: 40 });
    const doc = b.done();
    const e = new Engine(doc, 2e-5);
    const dev = e.byId.get(t)!;
    let top = 0;
    let bot = 0;
    for (let i = 0; i < 3000; i++) {
      e.step();
      const vt = e.volt(dev.nodes[2]);
      const vb = e.volt(dev.nodes[4]);
      if (i > 1000) {
        top = Math.max(top, vt);
        bot = Math.max(bot, vb);
        // Opposite phase: when the top end is high the bottom end is low.
        if (Math.abs(vt) > 1) expect(Math.sign(vt)).toBe(-Math.sign(vb));
      }
    }
    expect(top).toBeGreaterThan(4.5);
    expect(top).toBeLessThan(5.2);
    expect(bot).toBeGreaterThan(4.5);
  });

  it('both transistors take turns and the load gets the whole sine wave', () => {
    const doc = EXAMPLES.find((x) => x.id === 'push-pull')!.build();
    const e = new Engine(doc, 5e-6);
    const out = doc.parts.find((p) => p.type === 'probe' && p.params.ch === '1')!;
    for (let i = 0; i < 4000; i++) e.step();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 400; i++) {
      e.step();
      const v = e.byId.get(out.id)!.extra().v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi).toBeGreaterThan(0.3);
    expect(lo).toBeLessThan(-0.3);
    expect(e.failure).toBeNull();
  });
});
