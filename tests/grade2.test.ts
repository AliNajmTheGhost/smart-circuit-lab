import { describe, expect, it } from 'vitest';
import { GRADE2 } from '../src/examples-grade2';
import type { CircuitDoc } from '../src/model/types';
import { Engine, ENGINE_KIND } from './engine';

/** The time step the program itself picks for a circuit. */
function dtFor(doc: CircuitDoc): number {
  let f = 0;
  for (const p of doc.parts) if (p.type === 'ac' || p.type === 'funcgen') f = Math.max(f, Number(p.params.f) + (p.params.wave === 'fm' ? Number(p.params.dev) : 0));
  return f > 0 ? Math.min(1e-5, Math.max(2e-7, 1 / (f * 50))) : 1e-5;
}

/** Run `settle` seconds, then record probe `ch` for `span` seconds: swing and frequency. */
function measure(id: string, ch: string, settle: number, span: number) {
  const doc = GRADE2.find((x) => x.id === id)!.build();
  const e = new Engine(doc, dtFor(doc));
  const probe = doc.parts.find((p) => p.type === 'probe' && p.params.ch === ch)!;
  const burnt: string[] = [];
  for (let t = 0; t < settle; t += e.dt) burnt.push(...e.step().map((d) => d.key));
  const vs: number[] = [];
  for (let t = 0; t < span; t += e.dt) {
    burnt.push(...e.step().map((d) => d.key));
    vs.push(e.byId.get(probe.id)!.extra().v);
  }
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const mid = (lo + hi) / 2;
  let ups = 0;
  for (let i = 1; i < vs.length; i++) if (vs[i - 1] < mid && vs[i] >= mid) ups++;
  return { swing: hi - lo, f: ups / span, burnt, failure: e.failure };
}

describe.skipIf(ENGINE_KIND === 'ts')('grade-2 experiments', () => {
  it('the common-emitter stage amplifies about 12 times', () => {
    const m = measure('g2-ce', '2', 0.5, 0.01);
    expect(m.swing / 0.004).toBeGreaterThan(8);
    expect(m.swing / 0.004).toBeLessThan(20);
  });

  it('the tuned amplifier has its gain at the tank frequency', () => {
    const m = measure('g2-tuned-amp', '2', 0.05, 0.005);
    expect(m.swing / 0.02).toBeGreaterThan(20);
  });

  for (const [id, f] of [
    ['g2-phase-shift-tr', 590],
    ['g2-tuned-osc', 1070],
    ['g2-hartley', 1070],
    ['g2-colpitts', 1040],
  ] as const) {
    it(`${id} oscillates near ${f} Hz`, () => {
      const m = measure(id, '1', 0.15, 0.05);
      expect(m.swing).toBeGreaterThan(1);
      expect(m.f).toBeGreaterThan(f * 0.75);
      expect(m.f).toBeLessThan(f * 1.25);
      expect(m.burnt).toEqual([]);
    });
  }

  it('the astable multivibrator blinks without burning anything', () => {
    const m = measure('g2-astable', '1', 0.3, 1);
    expect(m.swing).toBeGreaterThan(2);
    expect(m.f).toBeGreaterThan(4);
    expect(m.f).toBeLessThan(15);
    expect(m.burnt).toEqual([]);
  });

  it('the monostable gives one pulse when the button is pressed', () => {
    const doc = GRADE2.find((x) => x.id === 'g2-monostable')!.build();
    const e = new Engine(doc);
    const btn = doc.parts.find((p) => p.type === 'button')!;
    const out = doc.parts.find((p) => p.type === 'probe' && p.params.ch === '1')!;
    const v = () => e.byId.get(out.id)!.extra().v;
    for (let i = 0; i < 10000; i++) e.step();
    expect(v()).toBeLessThan(0.5);
    btn.params.closed = 1;
    for (let i = 0; i < 1000; i++) e.step();
    btn.params.closed = 0;
    for (let i = 0; i < 2000; i++) e.step();
    expect(v()).toBeGreaterThan(3);
    for (let i = 0; i < 20000; i++) e.step();
    expect(v()).toBeLessThan(0.5);
  });

  it('the DIAC fires the triac and the lamp lights', () => {
    const doc = GRADE2.find((x) => x.id === 'g2-diac')!.build();
    const e = new Engine(doc, 1e-5);
    const lamp = doc.parts.find((p) => p.type === 'lamp')!;
    let max = 0;
    for (let i = 0; i < 20000; i++) {
      e.step();
      max = Math.max(max, e.byId.get(lamp.id)!.extra().brightness ?? 0);
    }
    expect(max).toBeGreaterThan(0.3);
  });

  it('an open line end doubles the pulse; a shorted one cancels it', () => {
    expect(measure('g2-tl-open', '2', 0.005, 0.01).swing).toBeGreaterThan(4.5);
    expect(measure('g2-tl-short', '2', 0.005, 0.01).swing).toBeLessThan(0.1);
  });
  it('the switches light segments a to f: the display shows 0', () => {
    const doc = GRADE2.find((x) => x.id === 'g2-7seg-switches')!.build();
    const e = new Engine(doc);
    for (let i = 0; i < 100; i++) e.step();
    const x = e.byId.get(doc.parts.find((p) => p.type === 'sevenseg')!.id)!.extra();
    const lit = 'abcdefg'.split('').filter((c) => (x[`seg_${c}`] ?? 0) > 0.3).join('');
    expect(lit).toBe('abcdef');
  });

  it('logic gates and the RS latch follow their truth tables', () => {
    const level = (e: Engine, id: string) => e.byId.get(id)!.extra().level;
    const g = GRADE2.find((x) => x.id === 'g2-gates')!.build();
    const [a, b] = g.parts.filter((p) => p.type === 'logicin');
    const outs = g.parts.filter((p) => p.type === 'logicout').map((p) => p.id);
    const eg = new Engine(g);
    const table: string[] = [];
    for (const [va, vb] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      a.params.state = va;
      b.params.state = vb;
      for (let i = 0; i < 50; i++) eg.step();
      table.push(outs.map((id) => level(eg, id)).join(''));
    }
    // NAND, NOR, XNOR, NOT(A)
    expect(table).toEqual(['1111', '1001', '1000', '0010']);

    const r = GRADE2.find((x) => x.id === 'g2-rs-latch')!.build();
    const [s, rr] = r.parts.filter((p) => p.type === 'logicin');
    const [q] = r.parts.filter((p) => p.type === 'logicout').map((p) => p.id);
    const er = new Engine(r);
    const settle = () => {
      for (let i = 0; i < 50; i++) er.step();
    };
    s.params.state = 0;
    settle();
    s.params.state = 1;
    settle();
    expect(level(er, q)).toBe(1);
    rr.params.state = 0;
    settle();
    rr.params.state = 1;
    settle();
    expect(level(er, q)).toBe(0);
  });
});
