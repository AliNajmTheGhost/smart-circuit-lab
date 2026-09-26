import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { Builder } from '../src/model/docops';
import { makePart } from '../src/model/docops';
import { emptyDoc, type CircuitDoc } from '../src/model/types';
import { traceCurves } from '../src/sim/curves';
import { Engine } from '../src/sim/engine';

const P = (x: number, y: number) => ({ x, y });
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const probe = (doc: CircuitDoc, ch: string) => doc.parts.find((p) => p.type === 'probe' && p.params.ch === ch)!.id;

/** Min and max of a probe over a stretch of simulated time, after letting the circuit settle. */
function swing(doc: CircuitDoc, ch: string, settle: number, span: number, dt = 1e-5) {
  const e = new Engine(doc, dt);
  const id = probe(doc, ch);
  for (let i = 0; i < settle / dt; i++) e.step();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < span / dt; i++) {
    e.step();
    const v = e.byId.get(id)!.extra().v;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { lo, hi, e };
}

describe('op-amp', () => {
  it('inverting amplifier has a gain of −10', () => {
    const doc = example('opamp-inv');
    const out = swing(doc, '2', 3e-3, 2e-3);
    expect(out.hi).toBeGreaterThan(4.6);
    expect(out.hi).toBeLessThan(5.2);
    expect(out.lo).toBeLessThan(-4.6);
    // Inverted: when the input peaks positive the output is negative.
    const e = new Engine(doc);
    for (let i = 0; i < 325; i++) e.step(); // t ≈ 3.25 ms, a positive input peak
    expect(e.byId.get(probe(doc, '1'))!.extra().v).toBeGreaterThan(0.45);
    expect(e.byId.get(probe(doc, '2'))!.extra().v).toBeLessThan(-4.5);
  });

  it('integrator turns a square wave into a triangle of about 0.5 V p-p', () => {
    const out = swing(example('integrator'), '2', 0.02, 2e-3);
    expect(out.hi - out.lo).toBeGreaterThan(0.4);
    expect(out.hi - out.lo).toBeLessThan(0.62);
  });

  it('differentiator turns a triangle into a ±4 V square wave', () => {
    const out = swing(example('differentiator'), '2', 3e-3, 2e-3);
    expect(out.hi).toBeGreaterThan(3.4);
    expect(out.lo).toBeLessThan(-3.4);
  });

  it('saturates near +Vsat as an open-loop comparator', () => {
    const b = new Builder();
    b.add('battery', 0, 40, 0, { V: 1 });
    b.add('ground', 0, 80);
    const u = b.add('opamp', 120, 0);
    b.add('ground', 80, -20);
    b.add('resistor', 200, 40, 1, { R: 10000 });
    b.add('ground', 200, 80);
    b.path(P(0, 0), P(0, 20), P(80, 20));
    b.path(P(160, 0), P(200, 0));
    const e = new Engine(b.done());
    for (let i = 0; i < 200; i++) e.step();
    const v = e.volt(e.byId.get(u)!.nodes[2]);
    expect(v).toBeGreaterThan(12.5);
    expect(v).toBeLessThan(13.1);
  });

  it('inverting amplifier shows +20 dB on the Bode plotter', () => {
    const doc = example('opamp-inv');
    const e = new Engine(doc);
    for (let i = 0; i < 100; i++) e.step();
    const fg = doc.parts.find((p) => p.type === 'funcgen')!.id;
    const [r] = e.acSweep(fg, e.net.pointNode.get('0,-20')!, e.net.pointNode.get('280,0')!, [1000]);
    expect(r.db).toBeCloseTo(20, 0);
    expect(Math.abs(r.phase)).toBeGreaterThan(170);
  });
});

describe('converters', () => {
  it('A/D gives floor(V / Vref × 16) without a clock', () => {
    const b = new Builder();
    b.add('battery', 0, 0, 0, { V: 3 });
    b.add('ground', 0, 40);
    const u = b.add('adc', 120, 20);
    b.path(P(0, -40), P(0, -60), P(60, -60), P(60, 0));
    const e = new Engine(b.done());
    for (let i = 0; i < 20; i++) e.step();
    expect(e.byId.get(u)!.extra().code).toBe(9);
  });

  it('A/D then D/A follows the input within one step of 5/16 V', () => {
    const doc = example('adc-dac');
    const e = new Engine(doc);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      e.step();
      if (i < 200) continue;
      const vin = e.byId.get(probe(doc, '1'))!.extra().v;
      const vout = e.byId.get(probe(doc, '2'))!.extra().v;
      worst = Math.max(worst, vin - vout);
    }
    // Sampled at 100 Hz on a 5 Hz sine: quantisation plus the change within one sample period.
    expect(worst).toBeLessThan(5 / 16 + 0.8);
    expect(worst).toBeGreaterThan(0);
  });
});

describe('transmission line', () => {
  const edge = (loadR: number) => {
    const doc = example('tline');
    doc.parts.find((p) => p.type === 'resistor')!.params.R = loadR;
    const e = new Engine(doc, 1e-6);
    const id = probe(doc, '2');
    let arrival = -1;
    let settled = 0;
    for (let i = 0; i < 180; i++) {
      e.step();
      const v = e.byId.get(id)!.extra().v;
      if (arrival < 0 && Math.abs(v) > 0.5) arrival = e.t;
      settled = v;
    }
    return { arrival, settled };
  };

  it('delays the pulse by Td into a matched load', () => {
    const { arrival, settled } = edge(75);
    expect(arrival).toBeGreaterThan(95e-6);
    expect(arrival).toBeLessThan(110e-6);
    expect(settled).toBeCloseTo(2.5, 1);
  });

  it('doubles the voltage at an open end and gives zero at a short', () => {
    expect(edge(1e9).settled).toBeCloseTo(5, 1);
    expect(Math.abs(edge(0.001).settled)).toBeLessThan(0.05);
  });
});

describe('digital modulation', () => {
  it('FSK sends f + dev for a 1 bit and f for a 0 bit', () => {
    const doc = emptyDoc();
    const fg = makePart(doc, 'funcgen', 0, 0, 0, { wave: 'fsk', Vp: 1, f: 1000, fm: 200, dev: 1000, r: 1 });
    doc.parts.push(fg, makePart(doc, 'ground', 0, 40), makePart(doc, 'resistor', 100, 0, 1, { R: 1000 }));
    doc.wires.push({ id: 'w1', a: P(0, -40), b: P(100, -40) }, { id: 'w2', a: P(0, 40), b: P(100, 40) });
    const e = new Engine(doc, 1e-6);
    const rises = [0, 0];
    let prev = 0;
    for (let i = 0; i < 10000; i++) {
      e.step();
      const v = e.volt(e.byId.get(fg.id)!.nodes[0]);
      if (prev < 0 && v >= 0) rises[e.t < 5e-3 ? 0 : 1]++;
      prev = v;
    }
    // First bit is 1 (2 kHz for 5 ms = 10 cycles), second is 0 (1 kHz = 5 cycles).
    expect(rises[0]).toBeGreaterThanOrEqual(9);
    expect(rises[0]).toBeLessThanOrEqual(10);
    expect(rises[1]).toBeGreaterThanOrEqual(4);
    expect(rises[1]).toBeLessThanOrEqual(5);
  });
});

describe('curve tracer', () => {
  it('diode curve passes 10 mA at about 0.6–0.8 V', () => {
    const doc = emptyDoc();
    const d = makePart(doc, 'diode', 0, 0);
    const plot = traceCurves(d);
    const p = plot.curves[0].pts.find((q) => q.i > 0.01)!;
    expect(p.v).toBeGreaterThan(0.6);
    expect(p.v).toBeLessThan(0.85);
  });

  it('NPN family shows Ic ≈ β × Ib in the active region', () => {
    const doc = emptyDoc();
    const q = makePart(doc, 'npn', 0, 0, 0, { beta: 100 });
    const plot = traceCurves(q);
    expect(plot.curves).toHaveLength(5);
    const c = plot.curves[1];
    const ib = Number(c.label.match(/(\d+)/)![1]) * 1e-6;
    const at5 = c.pts.reduce((a, b) => (Math.abs(b.v - 5) < Math.abs(a.v - 5) ? b : a));
    expect(at5.i / ib).toBeGreaterThan(85);
    expect(at5.i / ib).toBeLessThan(115);
  });
});
