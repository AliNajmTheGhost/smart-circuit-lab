import { describe, expect, it } from 'vitest';
import { Builder } from '../src/model/docops';
import type { ParamValue } from '../src/model/types';
import { Engine } from '../src/sim/engine';
import { parseValue } from '../src/units';

type Item = [type: string, params?: Record<string, ParamValue>, rot?: number];

/** Battery on the left, the given two-pin parts in a row along the top, return wire along the bottom. */
function loop(source: Item, items: Item[]) {
  const b = new Builder();
  const src = b.add(source[0], 0, 0, source[2] ?? 0, source[1] ?? {});
  b.add('ground', 0, 40);
  const ids = items.map(([type, params, rot], i) => b.add(type, 100 + 80 * i, -40, rot ?? 0, params ?? {}));
  const endX = 60 + 80 * items.length;
  b.path(b.pin(src, 0), { x: 60, y: -40 });
  b.path({ x: endX, y: -40 }, { x: endX, y: 40 }, { x: 0, y: 40 });
  return { doc: b.done(), ids, src };
}

function run(e: Engine, seconds: number) {
  const damaged = [];
  const n = Math.round(seconds / e.dt);
  for (let i = 0; i < n; i++) damaged.push(...e.step());
  return damaged;
}

describe('units', () => {
  it('reads values the way students type them', () => {
    expect(parseValue('4.7k')).toBeCloseTo(4700);
    expect(parseValue('4k7')).toBeCloseTo(4700);
    expect(parseValue('100uF')).toBeCloseTo(100e-6);
    expect(parseValue('10mH')).toBeCloseTo(0.01);
    expect(parseValue('1M')).toBeCloseTo(1e6);
    expect(parseValue('٢٢٠')).toBe(220);
    expect(parseValue('abc')).toBeNull();
  });
});

describe('simulator', () => {
  it('divides voltage between equal resistors (Ohm and Kirchhoff)', () => {
    const { doc, ids } = loop(['battery', { V: 10, r: 0.001 }], [['resistor', { R: 1000 }], ['resistor', { R: 1000 }]]);
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(e.reading(ids[1])!.v).toBeCloseTo(5, 2);
    expect(e.reading(ids[0])!.i).toBeCloseTo(0.005, 5);
  });

  it('charges a capacitor to 63% after one time constant', () => {
    const { doc, ids } = loop(['battery', { V: 10, r: 0.001 }], [['resistor', { R: 1000 }], ['capacitor', { C: 1e-6 }]]);
    const e = new Engine(doc, 1e-6);
    run(e, 1e-3);
    expect(e.reading(ids[1])!.v).toBeGreaterThan(6.2);
    expect(e.reading(ids[1])!.v).toBeLessThan(6.45);
  });

  it('lights an LED through a resistor without damage', () => {
    const { doc, ids } = loop(['battery', { V: 9 }], [['resistor', { R: 470 }], ['led', { color: 'red' }]]);
    const e = new Engine(doc);
    const damaged = run(e, 1e-3);
    expect(damaged).toHaveLength(0);
    const i = e.reading(ids[1])!.i;
    expect(i).toBeGreaterThan(0.012);
    expect(i).toBeLessThan(0.017);
  });

  it('burns an LED connected straight to a 9 V battery', () => {
    const { doc, ids } = loop(['battery', { V: 9 }], [['led', { color: 'red' }]]);
    const e = new Engine(doc);
    const damaged = run(e, 1e-4);
    expect(damaged.map((d) => d.part)).toContain(ids[0]);
    expect(damaged[0].key).toBe('burn.led');
  });

  it('holds 5.1 V across a reversed zener', () => {
    const { doc, ids } = loop(['battery', { V: 12 }], [['resistor', { R: 1000 }], ['zener', { Vz: 5.1 }, 2]]);
    const e = new Engine(doc);
    run(e, 1e-3);
    // Zener is rotated: pin 1 (anode) is on the right, so the voltage across it reads negative.
    expect(-e.reading(ids[1])!.v).toBeGreaterThan(4.9);
    expect(-e.reading(ids[1])!.v).toBeLessThan(5.3);
  });

  it('rectifies AC with a diode (half wave)', () => {
    const { doc, ids } = loop(['ac', { Vp: 12, f: 50 }], [['diode'], ['resistor', { R: 1000 }]]);
    const e = new Engine(doc, 2e-5);
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < 2000; i++) {
      e.step();
      const v = e.reading(ids[1])!.v;
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
    expect(max).toBeGreaterThan(11);
    expect(max).toBeLessThan(11.6);
    expect(min).toBeGreaterThan(-0.01);
  });

  function transistorCircuit(rb: number) {
    const b = new Builder();
    b.add('battery', 0, 0, 0, { V: 9 });
    b.add('ground', 0, 40);
    const q = b.add('npn', 200, 0);
    const rc = b.add('resistor', 220, -80, 1, { R: 1000 });
    b.add('resistor', 120, 0, 0, { R: rb });
    b.path({ x: 0, y: -40 }, { x: 0, y: -120 }, { x: 220, y: -120 });
    b.path({ x: 80, y: 0 }, { x: 80, y: -120 });
    b.path({ x: 220, y: 40 }, { x: 0, y: 40 });
    return { doc: b.done(), q, rc };
  }

  it('amplifies base current in the active region (Ic = β·Ib)', () => {
    const { doc, q } = transistorCircuit(470e3);
    const e = new Engine(doc);
    run(e, 5e-4);
    const x = e.byId.get(q)!.extra();
    expect(x.ic / x.ib).toBeGreaterThan(95);
    expect(x.ic / x.ib).toBeLessThan(102);
    expect(x.vce).toBeGreaterThan(6.9);
    expect(x.vce).toBeLessThan(7.5);
  });

  it('saturates as a switch with a small base resistor', () => {
    const { doc, q } = transistorCircuit(47e3);
    const e = new Engine(doc);
    run(e, 5e-4);
    expect(e.byId.get(q)!.extra().vce).toBeLessThan(0.3);
  });

  it('turns an N-MOSFET on with gate voltage', () => {
    const b = new Builder();
    b.add('battery', 0, 0, 0, { V: 9 });
    b.add('ground', 0, 40);
    const m = b.add('nmos', 200, 0);
    b.add('resistor', 220, -80, 1, { R: 1000 });
    b.path({ x: 0, y: -40 }, { x: 0, y: -120 }, { x: 220, y: -120 });
    b.path({ x: 160, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -120 });
    b.path({ x: 220, y: 40 }, { x: 0, y: 40 });
    const e = new Engine(b.done());
    run(e, 5e-4);
    expect(e.byId.get(m)!.extra().vds).toBeLessThan(0.5);
  });

  it('computes AND gate truth table', () => {
    const cases: [number, number, number][] = [
      [0, 0, 0],
      [0, 1, 0],
      [1, 0, 0],
      [1, 1, 1],
    ];
    for (const [a, bb, want] of cases) {
      const b = new Builder();
      b.add('logicin', 0, -20, 0, { state: a });
      b.add('logicin', 0, 20, 0, { state: bb });
      b.add('and', 80, 0);
      const out = b.add('logicout', 160, 0);
      const e = new Engine(b.done());
      run(e, 1e-4);
      expect(e.byId.get(out)!.extra().level).toBe(want);
    }
  });

  it('blows an ammeter fuse when it is connected across a battery', () => {
    const { doc, ids } = loop(['battery', { V: 9 }], [['ammeter']]);
    const e = new Engine(doc);
    const damaged = run(e, 1e-4);
    expect(damaged.map((d) => d.part)).toContain(ids[0]);
  });

  it('carries the same current in every wire of a series loop', () => {
    const { doc } = loop(['battery', { V: 10, r: 0.001 }], [['resistor', { R: 1000 }]]);
    const e = new Engine(doc);
    run(e, 1e-4);
    const w = e.wireCurrents(doc);
    const mags = [...w.values()].map(Math.abs);
    expect(mags.length).toBeGreaterThan(2);
    for (const m of mags) expect(m).toBeCloseTo(0.01, 4);
  });
});
