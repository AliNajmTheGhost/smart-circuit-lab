import { describe, expect, it } from 'vitest';
import { LESSONS, type LessonCtx } from '../src/lessons/lessons';
import type { CircuitDoc } from '../src/model/types';
import { checks } from './engine';
import { Engine } from './engine';

/** A lesson context backed by a bare engine, as the app would build it. */
function ctx(doc: CircuitDoc, e: Engine, broken: Set<string>, scopeOpen = false): LessonCtx {
  return {
    parts: (type) => doc.parts.filter((p) => p.type === type),
    reading: (p) => e.reading(p.id),
    broken: (p) => broken.has(p.id),
    num: (p, key) => Number(p.params[key]),
    scopeOpen,
  };
}

function simulate(e: Engine, seconds: number, broken: Set<string>) {
  const n = Math.round(seconds / e.dt);
  for (let i = 0; i < n; i++) for (const d of e.step()) broken.add(d.part);
}

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;

describe('lessons', () => {
  for (const l of LESSONS) {
    it(`${l.id}: starting circuit is wired`, () => {
      const doc = l.build();
      const e = new Engine(doc);
      const notes = checks(doc, e).filter((n) => n.level !== 'info');
      expect(notes.map((n) => n.key)).toEqual([]);
    });
  }

  it("Ohm's law: first check passes, second passes after changing R", () => {
    const doc = lesson('ohm').build();
    let e = new Engine(doc);
    const broken = new Set<string>();
    simulate(e, 0.2, broken);
    expect(lesson('ohm').steps[0].check!(ctx(doc, e, broken))).toBe(true);
    doc.parts.find((p) => p.type === 'resistor')!.params.R = 2000;
    e = new Engine(doc);
    simulate(e, 0.2, broken);
    expect(lesson('ohm').steps[1].check!(ctx(doc, e, broken))).toBe(true);
  });

  it('multimeter lesson reads 3.2 kΩ then 5.7 kΩ', () => {
    const l = lesson('ohmmeter');
    const doc = l.build();
    let e = new Engine(doc);
    const broken = new Set<string>();
    simulate(e, 1e-3, broken);
    expect(l.steps[0].check!(ctx(doc, e, broken))).toBe(true);
    doc.parts.find((p) => p.type === 'resistor' && p.params.R === 2200)!.params.R = 4700;
    e = new Engine(doc);
    simulate(e, 1e-3, broken);
    expect(l.steps[1].check!(ctx(doc, e, broken))).toBe(true);
  });

  it('transformer lesson reads about 12 V on the secondary', () => {
    const l = lesson('transformer');
    const doc = l.build();
    const e = new Engine(doc);
    const broken = new Set<string>();
    simulate(e, 0.3, broken);
    expect([...broken]).toEqual([]);
    expect(l.steps[0].check!(ctx(doc, e, broken))).toBe(true);
  });

  it('counter lesson reaches 5', () => {
    const l = lesson('counter');
    const doc = l.build();
    const e = new Engine(doc);
    const broken = new Set<string>();
    simulate(e, 0.55, broken);
    expect(l.steps[0].check!(ctx(doc, e, broken))).toBe(true);
  });

  it('LED lesson: the LED burns, then glows safely with 470 Ω', () => {
    const l = lesson('led-safe');
    const doc = l.build();
    let e = new Engine(doc);
    const broken = new Set<string>();
    simulate(e, 1e-3, broken);
    expect(l.steps[0].check!(ctx(doc, e, broken))).toBe(true);
    // Insert a 470 Ω resistor into the top wire, as a student would by dropping it there.
    const top = doc.wires.find((w) => w.a.y === -80 && w.b.y === -80)!;
    doc.parts.push({ id: 'r1', type: 'resistor', x: 120, y: -80, rot: 0, label: 'R1', params: { R: 470, Pmax: 0.25 } });
    doc.wires = doc.wires.filter((w) => w !== top);
    doc.wires.push({ id: 'w1', a: top.a, b: { x: 80, y: -80 } }, { id: 'w2', a: { x: 160, y: -80 }, b: top.b });
    broken.clear();
    e = new Engine(doc);
    simulate(e, 1e-3, broken);
    expect(l.steps[1].check!(ctx(doc, e, broken))).toBe(true);
  });
});
