/**
 * Speed of the original TypeScript engine against the Rust core, on the same circuits:
 *   npm run bench
 */
import { it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { Builder } from '../src/model/docops';
import type { CircuitDoc } from '../src/model/types';
import { Engine as TsEngine } from '../src/sim/engine';
import { WasmEngine } from '../src/sim/wasm/engine';
import { chooseDt } from '../src/sim/wasm/load';

/** A big resistor ladder with capacitors and diodes: n sections, about 2n nodes. */
function ladder(n: number): CircuitDoc {
  const b = new Builder('ladder');
  b.add('funcgen', 0, 0, 0, { f: 1000, Vp: 5 });
  b.add('ground', 0, 40);
  for (let i = 0; i < n; i++) {
    const x = 80 + i * 160;
    b.add('resistor', x + 40, -40, 0, { R: 1000 });
    b.add('capacitor', x + 80, 0, 1, { C: 1e-8 });
    b.add('diode', x + 120, 0, 1, {});
    b.path({ x: x + 80, y: -40 }, { x: x + 120, y: -40 });
    b.path({ x: x + 80, y: 40 }, { x: x + 120, y: 40 });
    b.path({ x: x - 80 + (i === 0 ? 80 : 0), y: -40 }, { x, y: -40 });
    b.path({ x: x - 80 + (i === 0 ? 80 : 0), y: 40 }, { x: x + 80, y: 40 });
  }
  b.path({ x: 0, y: -40 }, { x: 80, y: -40 });
  return b.done();
}

function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

it('speed', () => {
  const cases: [string, CircuitDoc, number][] = [
    ...['ce-amp', '555', 'counter', 'phase-shift', 'fdm', 'opamp-inv'].map(
      (id) => [id, EXAMPLES.find((e) => e.id === id)!.build(), 20000] as [string, CircuitDoc, number],
    ),
    ['ladder-20', ladder(20), 5000],
    ['ladder-60', ladder(60), 1000],
  ];
  const rows: string[] = [];
  for (const [name, doc, steps] of cases) {
    const dt = chooseDt(JSON.stringify(doc));
    const ts = new TsEngine(structuredClone(doc), dt);
    const tsMs = time(() => {
      for (let i = 0; i < steps; i++) ts.step();
    });
    const w1 = new WasmEngine(structuredClone(doc), dt);
    const stepMs = time(() => {
      for (let i = 0; i < steps; i++) w1.step();
    });
    const w2 = new WasmEngine(structuredClone(doc), dt);
    const runMs = time(() => w2.run(steps));
    const ksps = (ms: number) => ((steps / ms)).toFixed(0).padStart(6);
    rows.push(
      `${name.padEnd(12)} n=${String(ts.n).padStart(3)}  TS ${ksps(tsMs)}k/s   Rust step ${ksps(stepMs)}k/s   Rust batch ${ksps(runMs)}k/s   ×${(tsMs / runMs).toFixed(1)}`,
    );
    w1.dispose();
    w2.dispose();
  }
  console.log('\nsteps per second (thousands)\n' + rows.join('\n'));
}, 600000);
