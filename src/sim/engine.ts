import type { CircuitDoc } from '../model/types';
import { createDevice, type Ctx, type Device, type Issue } from './devices';
import { buildNetlist, wireCurrents, type Netlist } from './netlist';
import { solve, Stamper } from './stamper';

export interface PartIssue extends Issue {
  part: string;
}

const MAX_ITER = 60;

/**
 * Transient simulator. Each step solves the nodal equations with Newton's method,
 * then lets every component update its memory (capacitor voltage, gate output...).
 * It knows nothing about the screen, so it can later move to a Web Worker unchanged.
 */
export class Engine {
  readonly net: Netlist;
  readonly devices: Device[] = [];
  readonly byId = new Map<string, Device>();
  readonly n: number;
  x: Float64Array;
  t = 0;
  /** Set when the equations cannot be solved; the message key explains why. */
  failure: string | null = null;
  /** Steps that did not fully converge since the last reset. */
  roughSteps = 0;
  private readonly s: Stamper;
  private readonly guess: Float64Array;
  private readonly nonlinear: boolean;

  constructor(
    doc: CircuitDoc,
    public dt = 1e-5,
    broken: Set<string> = new Set(),
  ) {
    this.net = buildNetlist(doc);
    this.n = this.net.nodeCount;
    this.x = new Float64Array(this.n);
    this.guess = new Float64Array(this.n);
    this.s = new Stamper(this.n);
    for (const p of doc.parts) {
      const d = createDevice(p, this.net.pinNodes.get(p.id)!);
      d.broken = broken.has(p.id);
      this.devices.push(d);
      this.byId.set(p.id, d);
    }
    this.nonlinear = this.devices.some((d) => d.nonlinear);
  }

  /** Point devices at the edited document without restarting (values changed, wiring did not). */
  syncParts(doc: CircuitDoc): void {
    for (const p of doc.parts) {
      const d = this.byId.get(p.id);
      if (d) d.part = p;
    }
  }

  /** Keep capacitor charge, gate states etc. when the wiring changes. */
  exportState(): Map<string, unknown> {
    const m = new Map<string, unknown>();
    for (const d of this.devices) m.set(d.part.id, d.save());
    return m;
  }

  importState(m: Map<string, unknown>, t: number): void {
    for (const d of this.devices) if (m.has(d.part.id)) d.load(m.get(d.part.id));
    this.t = t;
  }

  /** Advance one time step. Returns parts that were damaged in this step. */
  step(): PartIssue[] {
    if (this.failure) return [];
    const t1 = this.t + this.dt;
    const ctx: Ctx = { t: t1, dt: this.dt, x: this.guess };
    this.guess.set(this.x);
    let converged = this.n === 0;
    for (let iter = 0; iter < MAX_ITER && this.n > 0; iter++) {
      this.s.clear();
      for (const d of this.devices) {
        d.limited = false;
        d.stamp(this.s, ctx);
      }
      // A tiny leak to ground keeps isolated pieces solvable.
      for (let i = 0; i < this.n; i++) this.s.G[i * this.n + i] += 1e-12;
      if (!solve(this.s.G, this.s.b, this.n)) {
        this.failure = 'fail.singular';
        return [];
      }
      const next = this.s.b;
      let ok = !this.devices.some((d) => d.limited);
      for (let i = 0; i < this.n; i++) {
        if (!Number.isFinite(next[i])) {
          this.failure = 'fail.diverged';
          return [];
        }
        if (Math.abs(next[i] - this.guess[i]) > 1e-6 + 1e-4 * Math.abs(next[i])) ok = false;
      }
      this.guess.set(next);
      if (!this.nonlinear || (ok && iter > 0)) {
        converged = true;
        break;
      }
    }
    if (!converged) this.roughSteps++;
    this.x.set(this.guess);
    this.t = t1;
    const acc: Ctx = { t: t1, dt: this.dt, x: this.x };
    const damaged: PartIssue[] = [];
    for (const d of this.devices) {
      d.accept(acc);
      if (d.broken) continue;
      const issue = d.limits(acc);
      if (issue?.level === 'burn') {
        d.broken = true;
        damaged.push({ ...issue, part: d.part.id });
      }
    }
    return damaged;
  }

  /** Voltage of a node (-1 is ground). */
  volt(node: number): number {
    return node < 0 ? 0 : (this.x[node] ?? 0);
  }

  /** Advice for the circuit doctor, from the latest state. */
  advice(): PartIssue[] {
    const out: PartIssue[] = [];
    for (const d of this.devices) {
      if (d.broken) continue;
      const a = d.advice(this.x);
      if (a) out.push({ ...a, part: d.part.id });
    }
    return out;
  }

  pinCurrents(): Map<string, number[]> {
    const m = new Map<string, number[]>();
    for (const d of this.devices) m.set(d.part.id, d.cur);
    return m;
  }

  wireCurrents(doc: CircuitDoc): Map<string, number> {
    return wireCurrents(doc, this.net, this.pinCurrents());
  }

  /** Voltage across, current through and power of a part (two-pin parts: pin 1 minus pin 2). */
  reading(partId: string): { v: number; i: number; p: number; extra: Record<string, number> } | null {
    const d = this.byId.get(partId);
    if (!d) return null;
    const nodes = d.nodes;
    const v = nodes.length >= 2 ? this.volt(nodes[0]) - this.volt(nodes[1]) : this.volt(nodes[0]);
    const i = d.cur[0] ?? 0;
    return { v, i, p: v * i, extra: d.extra() };
  }
}
