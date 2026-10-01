/**
 * Records reference results from the TypeScript engine so the Rust core can be checked against them:
 *   npx tsx scripts/make-golden.ts
 * Writes crates/core/tests/golden/<case>.json. Each case holds the circuit, the time step and,
 * every few steps, all node voltages, pin currents and live readings of every part.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXAMPLES } from '../src/examples';
import { LESSONS } from '../src/lessons/lessons';
import { Builder } from '../src/model/docops';
import { defaultParams } from '../src/model/library';
import type { CircuitDoc } from '../src/model/types';
import { traceCurves, canTrace } from '../src/sim/curves';
import { Engine } from '../src/sim/engine';

const OUT = new URL('../crates/core/tests/golden/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function chooseDt(doc: CircuitDoc): number {
  let fmax = 0;
  for (const p of doc.parts) {
    if (p.type !== 'ac' && p.type !== 'funcgen') continue;
    const f = Number(p.params.f) || 0;
    const extra = p.params.wave === 'fm' ? Number(p.params.dev) || 0 : 0;
    fmax = Math.max(fmax, f + extra);
  }
  if (fmax <= 0) return 1e-5;
  return Math.min(1e-5, Math.max(2e-7, 1 / (fmax * 50)));
}

interface Frame {
  step: number;
  t: number;
  x: number[];
  parts: Record<string, { cur: number[]; extra: Record<string, number>; broken: boolean }>;
}

function record(name: string, doc: CircuitDoc, steps: number, every: number): void {
  const dt = chooseDt(doc);
  const e = new Engine(doc, dt);
  const frames: Frame[] = [];
  const damage: { step: number; part: string; key: string }[] = [];
  const snap = (step: number) =>
    frames.push({
      step,
      t: e.t,
      x: [...e.x],
      parts: Object.fromEntries(
        e.devices.map((d) => [d.part.id, { cur: [...d.cur], extra: clean(d.extra()), broken: d.broken }]),
      ),
    });
  for (let i = 1; i <= steps; i++) {
    for (const d of e.step()) damage.push({ step: i, part: d.part, key: d.key });
    if (i % every === 0) snap(i);
    if (e.failure) break;
  }
  const out = {
    name,
    doc,
    dt,
    steps,
    every,
    nodeCount: e.net.nodeCount,
    n: e.n,
    pinNodes: Object.fromEntries(e.net.pinNodes),
    failure: e.failure,
    roughSteps: e.roughSteps,
    damage,
    frames,
  };
  writeFileSync(new URL(`${name}.json`, OUT), JSON.stringify(out));
  console.log(`${name}: n=${e.n} frames=${frames.length} damage=${damage.length} rough=${e.roughSteps}`);
}

/** Infinity (multimeter "OL") does not survive JSON; mark it with a huge number instead. */
function clean(x: Record<string, number>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, v] of Object.entries(x)) o[k] = Number.isFinite(v) ? v : v > 0 ? 1e300 : -1e300;
  return o;
}

for (const ex of EXAMPLES) record(`ex-${ex.id}`, ex.build(), 4000, 20);
for (const l of LESSONS) {
  const doc = l.build();
  if (doc.parts.length) record(`lesson-${l.id}`, doc, 2000, 20);
}

// Single-part stress cases: every type driven hard enough to burn, so damage rules are compared too.
const stress: [string, (b: Builder) => void][] = [
  ['burn-resistor', (b) => { b.add('battery', 0, 0, 0, { V: 24 }); b.add('ground', 0, 40); b.add('resistor', 100, -40, 0, { R: 100 }); b.path({ x: 0, y: -40 }, { x: 60, y: -40 }); b.path({ x: 140, y: -40 }, { x: 160, y: -40 }, { x: 160, y: 40 }, { x: 0, y: 40 }); }],
  ['burn-led', (b) => { b.add('battery', 0, 0, 0, { V: 9 }); b.add('ground', 0, 40); b.add('led', 100, -40, 0, {}); b.path({ x: 0, y: -40 }, { x: 60, y: -40 }); b.path({ x: 140, y: -40 }, { x: 160, y: -40 }, { x: 160, y: 40 }, { x: 0, y: 40 }); }],
];
for (const [name, build] of stress) {
  const b = new Builder(name);
  build(b);
  record(name, b.done(), 6000, 50);
}

// Characteristic curves of every traceable part type.
const curves: Record<string, unknown> = {};
for (const type of ['diode', 'zener', 'schottky', 'led', 'photodiode', 'npn', 'pnp', 'nmos', 'pmos']) {
  if (!canTrace(type)) continue;
  curves[type] = traceCurves({ id: 'q', type, x: 0, y: 0, rot: 0, label: 'Q1', params: defaultParams(type) });
}
writeFileSync(new URL('curves.json', OUT), JSON.stringify(curves));
console.log('curves written');
