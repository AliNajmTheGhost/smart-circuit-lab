import { Builder } from '../model/docops';
import type { Part } from '../model/types';
import { Engine } from './engine';

export interface IvCurve {
  label: string;
  pts: { v: number; i: number }[];
}

export interface IvPlot {
  xLabel: string;
  yLabel: string;
  curves: IvCurve[];
}

const DIODES = ['diode', 'zener', 'schottky', 'led', 'photodiode'];
export const canTrace = (type: string): boolean => DIODES.includes(type) || ['npn', 'pnp', 'nmos', 'pmos'].includes(type);

/** Settle the circuit at the present source values; damage is ignored so the whole curve can be drawn. */
function settle(e: Engine): void {
  for (let k = 0; k < 4; k++) {
    e.step();
    for (const d of e.devices) d.broken = false;
  }
}

const range = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/**
 * The characteristic curves of a single part, measured the way a curve tracer does:
 * the part alone in a test circuit, with its source voltage swept point by point.
 */
export function traceCurves(part: Part): IvPlot {
  if (DIODES.includes(part.type)) return diodeCurve(part);
  if (part.type === 'npn' || part.type === 'pnp') return bjtCurves(part);
  return fetCurves(part);
}

function diodeCurve(part: Part): IvPlot {
  const b = new Builder();
  const src = b.add('battery', 0, 0, 0, { V: 0, r: 0.001 });
  b.add('ground', 0, 40);
  const rs = part.type === 'led' ? 47 : part.type === 'zener' ? 22 : 10;
  b.add('resistor', 100, -40, 0, { R: rs, Pmax: 1e6 });
  const d = b.add(part.type, 180, 0, 1, { ...part.params });
  b.path({ x: 0, y: -40 }, { x: 60, y: -40 });
  b.path({ x: 140, y: -40 }, { x: 180, y: -40 });
  b.path({ x: 180, y: 40 }, { x: 0, y: 40 });
  const doc = b.done();
  const e = new Engine(doc);
  const bat = doc.parts.find((p) => p.id === src)!;
  const vz = Number(part.params.Vz) || 5.1;
  const lo = part.type === 'zener' ? -(vz + 2) : -5;
  const hi = part.type === 'led' ? 5 : 2.5;
  const pts: { v: number; i: number }[] = [];
  for (const v of range(lo, hi, 160)) {
    bat.params.V = v;
    settle(e);
    const r = e.reading(d)!;
    pts.push({ v: r.v, i: r.i });
  }
  return { xLabel: 'V', yLabel: 'I', curves: [{ label: '', pts }] };
}

function bjtCurves(part: Part): IvPlot {
  const pol = part.type === 'npn' ? 1 : -1;
  const b = new Builder();
  const vbb = b.add('battery', 0, 0, 0, { V: 0, r: 0.001 });
  b.add('ground', 0, 40);
  b.add('resistor', 100, -40, 0, { R: 100000, Pmax: 1e6 });
  const q = b.add(part.type, 180, -40, 0, { ...part.params, Pmax: 1e6 });
  const vcc = b.add('battery', 300, 0, 0, { V: 0, r: 0.001 });
  b.path({ x: 0, y: -40 }, { x: 60, y: -40 });
  b.path({ x: 200, y: -80 }, { x: 300, y: -80 }, { x: 300, y: -40 });
  b.path({ x: 200, y: 0 }, { x: 200, y: 40 }, { x: 0, y: 40 });
  b.path({ x: 300, y: 40 }, { x: 200, y: 40 });
  const doc = b.done();
  const bb = doc.parts.find((p) => p.id === vbb)!;
  const cc = doc.parts.find((p) => p.id === vcc)!;
  const curves: IvCurve[] = [];
  for (const ib of [10e-6, 20e-6, 30e-6, 40e-6, 50e-6]) {
    const e = new Engine(doc);
    bb.params.V = pol * (0.65 + ib * 100000);
    const pts: { v: number; i: number }[] = [];
    let ibMeasured = 0;
    for (const v of range(0, 10, 80)) {
      cc.params.V = pol * v;
      settle(e);
      const x = e.byId.get(q)!.extra();
      pts.push({ v: pol * x.vce, i: pol * x.ic });
      ibMeasured = pol * x.ib;
    }
    curves.push({ label: `Ib = ${Math.round(ibMeasured * 1e6)} µA`, pts });
  }
  return { xLabel: 'Vce', yLabel: 'Ic', curves };
}

function fetCurves(part: Part): IvPlot {
  const pol = part.type === 'nmos' ? 1 : -1;
  const vth = Number(part.params.Vth) || 2;
  const b = new Builder();
  const vgs = b.add('battery', 0, 0, 0, { V: 0, r: 0.001 });
  b.add('ground', 0, 40);
  const q = b.add(part.type, 180, -40, 0, { ...part.params });
  const vdd = b.add('battery', 300, 0, 0, { V: 0, r: 0.001 });
  b.path({ x: 0, y: -40 }, { x: 140, y: -40 });
  b.path({ x: 200, y: -80 }, { x: 300, y: -80 }, { x: 300, y: -40 });
  b.path({ x: 200, y: 0 }, { x: 200, y: 40 }, { x: 0, y: 40 });
  b.path({ x: 300, y: 40 }, { x: 200, y: 40 });
  const doc = b.done();
  const gs = doc.parts.find((p) => p.id === vgs)!;
  const dd = doc.parts.find((p) => p.id === vdd)!;
  const curves: IvCurve[] = [];
  for (const over of [0.5, 1, 1.5, 2, 2.5]) {
    const e = new Engine(doc);
    const g = vth + over;
    gs.params.V = pol * g;
    const pts: { v: number; i: number }[] = [];
    for (const v of range(0, 10, 80)) {
      dd.params.V = pol * v;
      settle(e);
      const x = e.byId.get(q)!.extra();
      pts.push({ v: pol * x.vds, i: pol * x.id });
    }
    curves.push({ label: `Vgs = ${g.toFixed(1)} V`, pts });
  }
  return { xLabel: 'Vds', yLabel: 'Id', curves };
}
