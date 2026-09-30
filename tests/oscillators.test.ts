import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { Builder } from '../src/model/docops';
import { Engine } from '../src/sim/engine';

const P = (x: number, y: number) => ({ x, y });

describe('energy-storing parts', () => {
  it('an LC tank keeps ringing (second-order integration does not drain it)', () => {
    // Capacitor charged to 5 V through a switch; the switch then hands it to the coil.
    const b = new Builder();
    const c = b.add('capacitor', 0, 0, 1, { C: 1e-6 });
    b.add('ground', 0, 40);
    b.add('inductor', 100, -40, 0, { L: 0.01, Rs: 0.001 });
    b.path(P(0, -40), P(60, -40));
    b.path(P(140, -40), P(140, 40), P(0, 40));
    const doc = b.done();
    const e = new Engine(doc, 1e-6);
    const dev = e.byId.get(c)! as unknown as { vPrev: number; vPrev2: number; hist: number };
    dev.vPrev = 5;
    dev.vPrev2 = 5;
    dev.hist = 1;
    // f = 1 / (2π√LC) ≈ 1.59 kHz, so 10 cycles ≈ 6.3 ms.
    let last = 0;
    for (let i = 0; i < 6300; i++) {
      e.step();
      if (i > 5600) last = Math.max(last, Math.abs(e.reading(c)!.v));
    }
    expect(last).toBeGreaterThan(4.5);
  });

  it('the linear solver reuses its factorisation in a linear circuit', () => {
    const doc = EXAMPLES.find((x) => x.id === 'divider')!.build();
    const e = new Engine(doc);
    for (let i = 0; i < 200; i++) e.step();
    expect(e.lu.reused).toBeGreaterThan(190);
  });
});

describe('RC phase-shift oscillator', () => {
  it('starts by itself and runs near 1 / (2π·R·C·√6) ≈ 650 Hz', () => {
    const doc = EXAMPLES.find((x) => x.id === 'phase-shift')!.build();
    const e = new Engine(doc);
    const out = doc.parts.find((p) => p.type === 'probe' && p.params.ch === '1')!.id;
    let prev = 0;
    const rises: number[] = [];
    let peak = 0;
    for (let i = 0; i < 0.2 / e.dt; i++) {
      e.step();
      const v = e.byId.get(out)!.extra().v;
      if (e.t > 0.12) {
        peak = Math.max(peak, Math.abs(v));
        if (prev < 0 && v >= 0) rises.push(e.t);
      }
      prev = v;
    }
    expect(peak).toBeGreaterThan(5);
    const f = (rises.length - 1) / (rises[rises.length - 1] - rises[0]);
    expect(f).toBeGreaterThan(520);
    expect(f).toBeLessThan(780);
  });
});

describe('rebuilding the simulator with a new time step', () => {
  it('does not kick a charging capacitor when the step shrinks', () => {
    const b = new Builder();
    b.add('battery', 0, 0, 0, { V: 10, r: 0.001 });
    b.add('ground', 0, 40);
    b.add('resistor', 100, -40, 0, { R: 1000 });
    const c = b.add('capacitor', 200, 0, 1, { C: 100e-6 });
    b.path(P(0, -40), P(60, -40));
    b.path(P(140, -40), P(200, -40));
    b.path(P(200, 40), P(0, 40));
    const doc = b.done();
    const coarse = new Engine(doc, 1e-5);
    for (let i = 0; i < 2000; i++) coarse.step();
    const fine = new Engine(doc, 2e-7);
    fine.importState(coarse.exportState(), coarse.t);
    const before = coarse.reading(c)!.v;
    fine.step();
    const dv = fine.reading(c)!.v - before;
    // Exact: dv = (10 / RC) · e^(−t/RC) · dt ≈ 1.64e-5 V at t = 20 ms.
    const exact = (10 / 0.1) * Math.exp(-coarse.t / 0.1) * 2e-7;
    expect(Math.abs(dv - exact)).toBeLessThan(0.2 * exact);
  });
});
