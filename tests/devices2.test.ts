import { describe, expect, it } from 'vitest';
import { Builder } from '../src/model/docops';
import type { ParamValue } from '../src/model/types';
import { Engine } from './engine';

type Item = [type: string, params?: Record<string, ParamValue>, rot?: number];
const P = (x: number, y: number) => ({ x, y });

function loop(source: Item, items: Item[]) {
  const b = new Builder();
  const src = b.add(source[0], 0, 0, source[2] ?? 0, source[1] ?? {});
  b.add('ground', 0, 40);
  const ids = items.map(([type, params, rot], i) => b.add(type, 100 + 80 * i, -40, rot ?? 0, params ?? {}));
  const endX = 60 + 80 * items.length;
  b.path(b.pin(src, 0), P(60, -40));
  b.path(P(endX, -40), P(endX, 40), P(0, 40));
  return { doc: b.done(), ids, src };
}

const run = (e: Engine, seconds: number) => {
  const n = Math.round(seconds / e.dt);
  for (let i = 0; i < n; i++) e.step();
};

/** Multimeter above a part lying flat below it, leads wired to the part's pins. */
function meterOn(type: string, params: Record<string, ParamValue>, mode: string, rot = 0) {
  const b = new Builder();
  const m = b.add('multimeter', 0, 0, 0, { mode });
  const part = b.add(type, 0, 120, rot, params);
  b.path(P(20, 60), P(40, 60), P(40, 120));
  b.path(P(-20, 60), P(-40, 60), P(-40, 120));
  return { doc: b.done(), m, part };
}

describe('multimeter', () => {
  it('measures resistance in ohm mode', () => {
    const { doc, m } = meterOn('resistor', { R: 4700 }, 'ohm');
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(e.byId.get(m)!.extra().reading).toBeCloseTo(4700, -1);
  });

  it('shows OL for an open circuit', () => {
    const b = new Builder();
    const m = b.add('multimeter', 0, 0, 0, { mode: 'ohm' });
    const e = new Engine(b.done());
    run(e, 1e-4);
    expect(e.byId.get(m)!.extra().reading).toBe(Infinity);
  });

  it('shows the forward drop in diode test, OL when reversed', () => {
    // Red lead (pin 1, right) on the anode: diode rotated so its anode is on the right.
    const fwd = meterOn('diode', {}, 'diode', 2);
    let e = new Engine(fwd.doc);
    run(e, 1e-4);
    const v = e.byId.get(fwd.m)!.extra().reading;
    expect(v).toBeGreaterThan(0.45);
    expect(v).toBeLessThan(0.75);
    const rev = meterOn('diode', {}, 'diode', 0);
    e = new Engine(rev.doc);
    run(e, 1e-4);
    expect(e.byId.get(rev.m)!.extra().reading).toBe(Infinity);
  });

  it('warns when measuring ohms on a powered circuit', () => {
    const { doc, ids } = loop(['battery', { V: 9 }], [['resistor', { R: 1000 }]]);
    const b = new Builder();
    b.doc = doc;
    const m = b.add('multimeter', 100, -160, 0, { mode: 'ohm' });
    b.path(P(120, -100), P(140, -100), P(140, -40));
    b.path(P(80, -100), P(60, -100), P(60, -40));
    const e = new Engine(b.done());
    run(e, 1e-4);
    expect(ids).toHaveLength(1);
    expect(e.advice().some((a) => a.part === m && a.key === 'warn.ohmPowered')).toBe(true);
  });
});

describe('power supply', () => {
  const circuit = (R: number) => {
    const b = new Builder();
    const ps = b.add('psu', 0, 0, 0, { V: 12, Ilim: 0.1 });
    b.add('ground', 0, 40);
    b.add('resistor', 100, 0, 1, { R, Pmax: 100 });
    b.path(P(0, -40), P(100, -40));
    b.path(P(0, 40), P(100, 40));
    return { doc: b.done(), ps };
  };
  it('holds its voltage under a light load (CV)', () => {
    const { doc, ps } = circuit(1000);
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(e.reading(ps)!.v).toBeCloseTo(12, 1);
    expect(e.byId.get(ps)!.extra().cc).toBe(0);
  });
  it('limits the current under a heavy load (CC)', () => {
    const { doc, ps } = circuit(10);
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(e.byId.get(ps)!.extra().iout).toBeCloseTo(0.1, 3);
    expect(e.reading(ps)!.v).toBeCloseTo(1, 1);
    expect(e.byId.get(ps)!.extra().cc).toBe(1);
  });
});

describe('transformer', () => {
  it('steps the voltage down by the turns ratio', () => {
    const b = new Builder();
    b.add('ac', 0, 0, 0, { Vp: 12, f: 50 });
    b.add('ground', 0, 40);
    b.add('transformer', 120, 0, 0, { n: 2 });
    const load = b.add('resistor', 240, 0, 1, { R: 1000 });
    b.add('ground', 240, 40);
    b.path(P(0, -40), P(80, -40));
    b.path(P(0, 40), P(80, 40));
    b.path(P(160, -40), P(240, -40));
    b.path(P(160, 40), P(240, 40));
    const e = new Engine(b.done());
    run(e, 0.06);
    let peak = 0;
    for (let i = 0; i < 2000; i++) {
      e.step();
      peak = Math.max(peak, Math.abs(e.reading(load)!.v));
    }
    expect(peak).toBeGreaterThan(5.6);
    expect(peak).toBeLessThan(6.2);
  });
});

describe('light sensors', () => {
  it('LDR resistance falls with light', () => {
    const b = new Builder();
    const dark = b.add('ldr', 0, 0, 0, { light: 0 });
    const lit = b.add('ldr', 0, 100, 0, { light: 1 });
    const e = new Engine(b.done());
    expect(e.byId.get(dark)!.extra().r).toBeCloseTo(1e6, -3);
    expect(e.byId.get(lit)!.extra().r).toBeCloseTo(500, 0);
  });

  it('photodiode current follows the light level', () => {
    // Photodiode rotated so its cathode faces the battery's positive side (reverse bias).
    const { doc, ids } = loop(['battery', { V: 5 }], [['photodiode', { light: 0.5, Isc: 100e-6 }, 2], ['resistor', { R: 10000 }]]);
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(Math.abs(e.reading(ids[1])!.v)).toBeCloseTo(0.5, 2);
  });
});

describe('thyristors', () => {
  function circuit(type: 'scr' | 'triac', source: Item) {
    const b = new Builder();
    b.add(source[0], 0, 0, 0, source[1]);
    b.add('ground', 0, 40);
    const lamp = b.add('lamp', 160, -80, 0, { V: 12, P: 5 });
    const th = b.add(type, 280, 0, 1);
    b.add('resistor', 160, 20, 0, { R: 1000 });
    const sw = b.add('switch', 80, 20);
    b.path(P(0, -40), P(0, -80), P(120, -80));
    b.path(P(200, -80), P(280, -80), P(280, -40));
    b.path(P(280, 40), P(0, 40));
    b.path(P(200, 20), P(240, 20));
    b.path(P(40, 20), P(40, -80));
    return { doc: b.done(), lamp, th, sw };
  }

  it('SCR latches on after a gate pulse and stays on', () => {
    const { doc, lamp, th, sw } = circuit('scr', ['battery', { V: 12 }]);
    const e = new Engine(doc);
    run(e, 1e-3);
    expect(Math.abs(e.reading(lamp)!.i)).toBeLessThan(1e-4);
    doc.parts.find((p) => p.id === sw)!.params.closed = 1;
    run(e, 1e-3);
    expect(e.byId.get(th)!.extra().on).toBe(1);
    expect(Math.abs(e.reading(lamp)!.i)).toBeGreaterThan(0.3);
    doc.parts.find((p) => p.id === sw)!.params.closed = 0;
    run(e, 1e-3);
    expect(e.byId.get(th)!.extra().on).toBe(1);
    expect(Math.abs(e.reading(lamp)!.i)).toBeGreaterThan(0.3);
  });

  it('triac conducts both half-cycles of AC when triggered', () => {
    const { doc, lamp, sw } = circuit('triac', ['ac', { Vp: 12, f: 50 }]);
    doc.parts.find((p) => p.id === sw)!.params.closed = 1;
    const e = new Engine(doc, 2e-5);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 2000; i++) {
      e.step();
      const I = e.reading(lamp)!.i;
      lo = Math.min(lo, I);
      hi = Math.max(hi, I);
    }
    expect(hi).toBeGreaterThan(0.25);
    expect(lo).toBeLessThan(-0.25);
  });
});

describe('integrated circuits', () => {
  it('555 astable oscillates near 1.44 / ((R1 + 2R2)·C)', () => {
    const b = new Builder();
    b.add('battery', 0, 0, 0, { V: 9 });
    b.add('ground', 0, 40);
    const u = b.add('timer555', 300, 0);
    b.add('resistor', 160, -120, 1, { R: 1000 });
    b.add('resistor', 160, 0, 1, { R: 10000 });
    b.add('capacitor', 160, 120, 1, { C: 1e-6 });
    b.add('resistor', 400, 40, 1, { R: 1000 });
    b.path(P(0, -40), P(0, -160), P(320, -160));
    b.path(P(280, -80), P(280, -160));
    b.path(P(320, -80), P(320, -160));
    b.path(P(160, -80), P(160, -40), P(240, -40));
    b.path(P(160, 40), P(240, 40));
    b.path(P(240, 0), P(240, 40));
    b.path(P(160, 40), P(160, 80));
    b.path(P(0, 40), P(0, 160), P(400, 160));
    b.path(P(300, 80), P(300, 160));
    b.path(P(360, 0), P(400, 0));
    b.path(P(400, 80), P(400, 160));
    const e = new Engine(b.done());
    const edges: number[] = [];
    let prev = 0;
    for (let i = 0; i < 12000; i++) {
      e.step();
      const q = e.byId.get(u)!.extra().out;
      if (q === 1 && prev === 0) edges.push(e.t);
      prev = q;
    }
    expect(edges.length).toBeGreaterThan(4);
    const period = (edges[edges.length - 1] - edges[1]) / (edges.length - 2);
    const expected = 1 / (1.44 / (21000 * 1e-6));
    expect(period / expected).toBeGreaterThan(0.85);
    expect(period / expected).toBeLessThan(1.15);
  });

  it('counter drives a 7-segment display through the decoder', () => {
    const b = new Builder();
    b.add('funcgen', 0, 0, 0, { wave: 'pulse', Vp: 5, f: 100, duty: 0.5, r: 1 });
    b.add('ground', 0, 40);
    const cnt = b.add('counter', 160, -40);
    b.add('bcd7', 340, -40);
    const ds = b.add('sevenseg', 480, -40);
    b.add('ground', 480, 60);
    b.path(P(0, -40), P(0, -80), P(100, -80));
    for (const y of [-80, -60, -40, -20]) b.path(P(220, y), P(280, y));
    for (let y = -100; y <= 20; y += 20) b.path(P(400, y), P(440, y));
    const e = new Engine(b.done());
    run(e, 0.035);
    expect(e.byId.get(cnt)!.extra().count).toBe(4);
    const seg = e.byId.get(ds)!.extra();
    for (const on of ['seg_b', 'seg_c', 'seg_f', 'seg_g']) expect(seg[on]).toBeGreaterThan(0.5);
    for (const off of ['seg_a', 'seg_d', 'seg_e']) expect(seg[off]).toBeLessThan(0.05);
  });

  it('D flip-flop stores D on the rising clock edge', () => {
    const b = new Builder();
    const d = b.add('logicin', 0, -20, 0, { state: 1 });
    const clk = b.add('logicin', 0, 20, 0, { state: 0 });
    const ff = b.add('dff', 80, 0);
    const doc = b.done();
    const e = new Engine(doc);
    run(e, 1e-4);
    expect(e.byId.get(ff)!.extra().q).toBe(0);
    doc.parts.find((p) => p.id === clk)!.params.state = 1;
    run(e, 1e-4);
    expect(e.byId.get(ff)!.extra().q).toBe(1);
    doc.parts.find((p) => p.id === d)!.params.state = 0;
    run(e, 1e-4);
    expect(e.byId.get(ff)!.extra().q).toBe(1);
  });
});

describe('Bode analysis', () => {
  it('RC low-pass is 3 dB down with −45° at its cut-off frequency', () => {
    const b = new Builder();
    const fg = b.add('funcgen', 0, 0, 0, { r: 0.001 });
    b.add('ground', 0, 40);
    b.add('resistor', 100, -80, 0, { R: 1000 });
    b.add('capacitor', 200, 0, 1, { C: 1e-6 });
    b.path(P(0, -40), P(0, -80), P(60, -80));
    b.path(P(140, -80), P(200, -80), P(200, -40));
    b.path(P(200, 40), P(0, 40));
    const e = new Engine(b.done());
    const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
    const [r] = e.acSweep(fg, e.net.pointNode.get('0,-80')!, e.net.pointNode.get('200,-80')!, [fc]);
    expect(r.db).toBeCloseTo(-3.01, 1);
    expect(r.phase).toBeCloseTo(-45, 0);
  });
});
