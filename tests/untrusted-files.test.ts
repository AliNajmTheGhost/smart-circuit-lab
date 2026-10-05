import { describe, expect, it } from 'vitest';
import { sanitizeDoc } from '../src/model/sanitize';
import { EXAMPLES } from '../src/examples';
import { CHALLENGES, buildChallenge } from '../src/challenges/challenges';

/**
 * A circuit file can come from anywhere, so these are the files a hostile one would be.
 * Nothing in a file may reach the drawing as markup, steer a number out of its range,
 * or name a part that does not exist.
 */

const part = (over: Record<string, unknown> = {}) => ({ id: 'p1', type: 'resistor', x: 100, y: 100, rot: 0, label: 'R1', params: { R: 1000 }, ...over });
const doc = (over: Record<string, unknown> = {}) => ({ version: 1, title: 'c', parts: [part()], wires: [], ...over });

/** Everything the file asked to put on the board, as one string, the way the page would see it. */
const rendered = (d: unknown) => JSON.stringify(d);

describe('a circuit file from outside', () => {
  it('is rejected when it is not a circuit at all', () => {
    expect(sanitizeDoc(null)).toBeNull();
    expect(sanitizeDoc('battery')).toBeNull();
    expect(sanitizeDoc({ version: 2, parts: [], wires: [] })).toBeNull();
    expect(sanitizeDoc({ version: 1, parts: {}, wires: [] })).toBeNull();
    expect(sanitizeDoc({ version: 1, parts: [], wires: {} })).toBeNull();
  });

  it('refuses a part the program does not have', () => {
    expect(sanitizeDoc(doc({ parts: [part({ type: 'death-ray' })] }))).toBeNull();
  });

  it('gives every part and wire a fresh identifier, so none comes from the file', () => {
    const payload = 'x"><image href=x onerror=alert(1)><g data-x="';
    const d = sanitizeDoc(doc({ parts: [part({ id: payload })], wires: [{ id: payload, a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }] }))!.doc;
    expect(d.parts[0].id).not.toContain('<');
    expect(d.wires[0].id).not.toContain('<');
    expect(rendered(d)).not.toContain('onerror');
  });

  it('keeps coordinates numeric, so they cannot break out of an attribute', () => {
    const payload = '0" onload="alert(1)';
    expect(sanitizeDoc(doc({ parts: [part({ x: payload })] }))).toBeNull();
    const d = sanitizeDoc(doc({ wires: [{ id: 'w', a: { x: payload, y: 0 }, b: { x: 40, y: 0 } }] }))!.doc;
    // The wire is dropped rather than drawn with a string where a number belongs.
    expect(d.wires).toHaveLength(0);
    expect(rendered(d)).not.toContain('onload');
  });

  it('drops coordinates that are not finite', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity, 1e300]) {
      expect(sanitizeDoc(doc({ parts: [part({ x: bad })] }))).toBeNull();
    }
  });

  it('takes a drop-down value only from that part\'s own list', () => {
    const d = sanitizeDoc(doc({ parts: [part({ type: 'probe', params: { ch: '<img src=x onerror=alert(1)>' } })] }))!.doc;
    expect(d.parts[0].params.ch).toBe('1');
    expect(rendered(d)).not.toContain('onerror');
  });

  it('holds a number parameter inside the range the part allows', () => {
    const d = sanitizeDoc(doc({ parts: [part({ type: 'pot', params: { pos: 9999 } })] }))!.doc;
    expect(Number(d.parts[0].params.pos)).toBeLessThanOrEqual(1);
    const neg = sanitizeDoc(doc({ parts: [part({ type: 'pot', params: { pos: -9999 } })] }))!.doc;
    expect(Number(neg.parts[0].params.pos)).toBeGreaterThanOrEqual(0);
  });

  it('replaces a parameter of the wrong kind with the part\'s default', () => {
    const d = sanitizeDoc(doc({ parts: [part({ params: { R: { toString: 'nope' } } })] }))!.doc;
    expect(typeof d.parts[0].params.R).toBe('number');
    expect(Number.isFinite(Number(d.parts[0].params.R))).toBe(true);
  });

  it('carries no parameter the part never declared, apart from a repair fault', () => {
    const d = sanitizeDoc(doc({ parts: [part({ params: { R: 1000, _fault: 'open', evil: '<script>' } })] }))!.doc;
    expect(d.parts[0].params._fault).toBe('open');
    expect(d.parts[0].params.evil).toBeUndefined();
    const bogus = sanitizeDoc(doc({ parts: [part({ params: { R: 1000, _fault: 'melt' } })] }))!.doc;
    expect(bogus.parts[0].params._fault).toBeUndefined();
  });

  it('strips control characters and over-long text from the title and the label', () => {
    const d = sanitizeDoc(doc({ title: `a\u0000b\u001fc${'x'.repeat(500)}`, parts: [part({ label: '\u0000'.repeat(10) })] }))!.doc;
    expect(d.title).not.toMatch(/[\u0000-\u001f]/);
    expect(d.title.length).toBeLessThanOrEqual(120);
    expect(d.parts[0].label).toBe('R');
  });

  it('turns a rotation into one of the four quarter turns', () => {
    for (const [given, want] of [
      [0, 0],
      [3, 3],
      [7, 3],
      [-1, 3],
      ['2', 0],
      [Number.NaN, 0],
    ] as [unknown, number][]) {
      expect(sanitizeDoc(doc({ parts: [part({ rot: given })] }))!.doc.parts[0].rot).toBe(want);
    }
  });

  it('refuses a file big enough to hang the program', () => {
    expect(sanitizeDoc(doc({ parts: Array.from({ length: 5001 }, () => part()) }))).toBeNull();
    expect(sanitizeDoc(doc({ wires: Array.from({ length: 20001 }, () => ({ id: 'w', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } })) }))).toBeNull();
  });

  it('says how much of a damaged file had to be left out', () => {
    const s = sanitizeDoc(doc({ wires: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, { id: 'w2', a: { x: 'oops', y: 0 }, b: { x: 40, y: 0 } }] }))!;
    expect(s.doc.wires).toHaveLength(1);
    expect(s.dropped).toBe(1);
    expect(sanitizeDoc(doc())!.dropped).toBe(0);
  });

  it('opens every circuit the program itself ships, losing nothing', () => {
    // The examples use the whole parts library, so this is the check that the rules above are
    // strict about hostile files without turning away a circuit a student actually saved.
    for (const ex of EXAMPLES) {
      const saved = ex.build();
      const file = JSON.parse(JSON.stringify({ ...saved, generator: 'Smart Circuit Lab 0.3.0' }));
      const s = sanitizeDoc(file);
      expect(s, ex.id).not.toBeNull();
      expect(s!.dropped, ex.id).toBe(0);
      expect(s!.doc.parts.map((p) => [p.type, p.x, p.y, p.rot, p.label]), ex.id).toEqual(saved.parts.map((p) => [p.type, p.x, p.y, p.rot, p.label]));
      expect(s!.doc.parts.map((p) => p.params), ex.id).toEqual(saved.parts.map((p) => p.params));
      expect(s!.doc.wires.map((w) => [w.a, w.b]), ex.id).toEqual(saved.wires.map((w) => [w.a, w.b]));
    }
  });

  it('keeps the hidden fault of a repair challenge', () => {
    const c = CHALLENGES[0];
    const broken = buildChallenge(c);
    const s = sanitizeDoc(JSON.parse(JSON.stringify(broken)))!;
    expect(s.dropped).toBe(0);
    expect(s.doc.parts.some((p) => p.params._fault === c.fault.kind)).toBe(true);
  });

  it('still opens an ordinary circuit unchanged', () => {
    const d = sanitizeDoc(doc({ title: 'مصباح وبطارية', wires: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }] }))!.doc;
    expect(d.title).toBe('مصباح وبطارية');
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0].type).toBe('resistor');
    expect(d.parts[0].label).toBe('R1');
    expect(d.parts[0].params.R).toBe(1000);
    expect(d.wires).toHaveLength(1);
    expect(d.wires[0].a).toEqual({ x: 0, y: 0 });
  });
});
