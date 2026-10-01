import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { coerceParam, defOf } from '../src/model/library';
import { Engine } from './engine';

const param = (type: string, key: string) => defOf(type).params.find((p) => p.key === key)!;

describe('drop-down values keep the type of their default', () => {
  it('counter mode stays text, switch and logic states stay numbers', () => {
    expect(coerceParam(param('counter', 'mod'), '16')).toBe('16');
    expect(coerceParam(param('probe', 'ch'), '2')).toBe('2');
    expect(coerceParam(param('switch', 'closed'), '1')).toBe(1);
    expect(coerceParam(param('logicin', 'state'), '1')).toBe(1);
  });
});

describe('counter in 0–15 mode', () => {
  for (const value of ['16', 16]) {
    it(`counts past 9 when the mode is ${typeof value} ${value}`, () => {
      const doc = EXAMPLES.find((e) => e.id === 'counter')!.build();
      const cnt = doc.parts.find((p) => p.type === 'counter')!;
      cnt.params.mod = value;
      const e = new Engine(doc);
      // 10 Hz clock: 12.5 rising edges in 1.25 s.
      let max = 0;
      for (let i = 0; i < 1.25 / e.dt; i++) {
        e.step();
        max = Math.max(max, e.byId.get(cnt.id)!.extra().count);
      }
      expect(max).toBeGreaterThanOrEqual(12);
      expect(max).toBeLessThanOrEqual(13);
    });
  }

  it('decoder blanks the display for 10–15', () => {
    const doc = EXAMPLES.find((e) => e.id === 'counter')!.build();
    const cnt = doc.parts.find((p) => p.type === 'counter')!;
    const ds = doc.parts.find((p) => p.type === 'sevenseg')!;
    cnt.params.mod = '16';
    const e = new Engine(doc);
    for (let i = 0; i < 1.05 / e.dt; i++) e.step();
    expect(e.byId.get(cnt.id)!.extra().count).toBe(11);
    const seg = e.byId.get(ds.id)!.extra();
    for (const k of Object.keys(seg)) expect(seg[k]).toBeLessThan(0.05);
  });
});
