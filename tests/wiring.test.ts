import { describe, expect, it } from 'vitest';
import { Builder, routeWire } from '../src/model/docops';

const P = (x: number, y: number) => ({ x, y });

/** The circuit from the bug report: battery on the left (+ at 0,-40), resistor upright on the right. */
function batteryAndResistor() {
  const b = new Builder();
  b.add('battery', 0, 0, 0, { V: 9 });
  b.add('resistor', 180, 0, 1, { R: 1000 });
  b.add('ground', 90, 80);
  b.path(P(0, 40), P(0, 80), P(180, 80), P(180, 40));
  return b.done();
}

describe('drawing a wire', () => {
  it('stops on the battery terminal instead of leaving a stub past it', () => {
    const doc = batteryAndResistor();
    // From the resistor's top pin, released a little above the battery's + terminal.
    const wires = routeWire(doc, P(180, -40), P(0, -100), true);
    expect(wires).toHaveLength(1);
    expect(wires[0].a).toEqual(P(180, -40));
    expect(wires[0].b).toEqual(P(0, -40));
  });

  it('bends the way the pointer first moved', () => {
    const doc = batteryAndResistor();
    const up = routeWire(doc, P(180, -40), P(60, -120), false);
    expect(up[0].a.x).toBe(up[0].b.x); // leaves vertically
    const across = routeWire(doc, P(180, -40), P(60, -120), true);
    expect(across[0].a.y).toBe(across[0].b.y); // leaves horizontally
  });

  it('ends where the pointer is when nothing lies on the way', () => {
    const doc = batteryAndResistor();
    const wires = routeWire(doc, P(180, -40), P(260, -120), true);
    expect(wires[wires.length - 1].b).toEqual(P(260, -120));
  });
});
