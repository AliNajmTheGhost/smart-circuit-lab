import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import type { CircuitDoc } from '../src/model/types';
import { Engine } from './engine';

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const part = (doc: CircuitDoc, type: string, nth = 0) => doc.parts.filter((p) => p.type === type)[nth];
const probe = (doc: CircuitDoc, ch: string) => doc.parts.find((p) => p.type === 'probe' && p.params.ch === ch)!.id;

describe('infrared remote control', () => {
  const ledCurrent = (pressed: boolean, blocked = false) => {
    const doc = example('ir-remote');
    part(doc, 'button').params.closed = pressed ? 1 : 0;
    if (blocked) part(doc, 'irrx').params.path = 'blocked';
    const e = new Engine(doc);
    for (let i = 0; i < 300; i++) e.step();
    return e.reading(part(doc, 'led').id)!.i;
  };

  it('lights the far LED only while the button is pressed', () => {
    expect(ledCurrent(false)).toBeLessThan(1e-4);
    expect(ledCurrent(true)).toBeGreaterThan(0.008);
  });

  it('stays dark when something blocks the beam', () => {
    expect(ledCurrent(true, true)).toBeLessThan(1e-4);
  });
});

describe('time-division multiplexing', () => {
  it('the receiver recovers the first signal from the shared line', () => {
    const doc = example('tdm');
    const e = new Engine(doc);
    const src = part(doc, 'funcgen', 0);
    const out = probe(doc, '2');
    let worst = 0;
    for (let i = 0; i < 0.06 / e.dt; i++) {
      e.step();
      if (e.t < 0.02) continue;
      const want = 2 * Math.sin(2 * Math.PI * 50 * e.t);
      worst = Math.max(worst, Math.abs(e.byId.get(out)!.extra().v - want));
    }
    expect(src.params.f).toBe(50);
    // Sample-and-hold every 1 ms on a 50 Hz sine: the error stays below one step of change.
    expect(worst).toBeLessThan(0.75);
  });
});

describe('frequency-division multiplexing', () => {
  it('the 5 kHz band-pass filter picks out the 5 kHz channel', () => {
    const doc = example('fdm');
    const e = new Engine(doc);
    const out = probe(doc, '2');
    let prev = 0;
    let rises = 0;
    for (let i = 0; i < 0.012 / e.dt; i++) {
      e.step();
      const v = e.byId.get(out)!.extra().v;
      if (e.t > 0.01 && prev < 0 && v >= 0) rises++;
      prev = v;
    }
    // 2 ms of a 5 kHz carrier is about 10 cycles; 20 kHz leaking through would give about 40.
    expect(rises).toBeGreaterThanOrEqual(8);
    expect(rises).toBeLessThanOrEqual(12);
  });
});

describe('LCD display', () => {
  it('shows the counter value like the LED display does', () => {
    const doc = example('lcd-counter');
    const e = new Engine(doc);
    // Count 4 starts at 0.3 s; give the slow liquid crystal time to settle.
    for (let i = 0; i < 0.39 / e.dt; i++) e.step();
    expect(e.byId.get(part(doc, 'counter').id)!.extra().count).toBe(4);
    const seg = e.byId.get(part(doc, 'lcd7').id)!.extra();
    for (const on of ['seg_b', 'seg_c', 'seg_f', 'seg_g']) expect(seg[on]).toBeGreaterThan(0.8);
    for (const off of ['seg_a', 'seg_d', 'seg_e']) expect(seg[off]).toBeLessThan(0.1);
  });
});
