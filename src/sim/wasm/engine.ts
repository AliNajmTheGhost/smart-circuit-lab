/**
 * The Rust core behind the same interface as the original TypeScript `Engine`,
 * so the board, inspector, scope and lessons work unchanged while the maths runs in WebAssembly.
 */
import { defOf } from '../../model/library';
import type { CircuitDoc, ParamValue, Part } from '../../model/types';
import type { DoctorNote } from '../doctor';
import type { Issue } from '../devices';
import type { PartIssue } from '../engine';
import { Sim, traceCurves } from './load';

export interface EngineOptions {
  /**
   * Notice parameter changes made directly on `doc.parts[i].params` before each step.
   * Convenient for tests; the interface instead calls `syncParts` after each edit.
   */
  watchParams?: boolean;
}

/** A read-only view of one part inside the core, shaped like the old `Device`. */
export class PartView {
  constructor(
    private readonly sim: Sim,
    public part: Part,
    public readonly nodes: number[],
  ) {}
  get cur(): number[] {
    return [...this.sim.cur(this.part.id)];
  }
  get broken(): boolean {
    return this.sim.broken(this.part.id);
  }
  set broken(v: boolean) {
    this.sim.setBroken(this.part.id, v);
  }
  extra(): Record<string, number> {
    return fromJsonNumbers(this.sim.extra(this.part.id));
  }
}

/** Meter "OL" crosses the boundary as ±1e300; turn it back into ±Infinity. */
function fromJsonNumbers(json: string): Record<string, number> {
  const o = JSON.parse(json) as Record<string, number>;
  for (const k in o) if (Math.abs(o[k]) >= 1e299) o[k] = o[k] > 0 ? Infinity : -Infinity;
  return o;
}

export interface NetView {
  nodeCount: number;
  hasGround: boolean;
  autoGroundPart: string | null;
  pinNodes: Map<string, number[]>;
  pointNode: { get(key: string): number | undefined };
}

export class WasmEngine {
  readonly sim: Sim;
  readonly net: NetView;
  readonly devices: PartView[];
  readonly byId = new Map<string, PartView>();
  readonly lu: { readonly reused: number };
  private doc: CircuitDoc;
  private paramsSeen: string[] = [];

  constructor(
    doc: CircuitDoc,
    dt = 1e-5,
    broken: Set<string> = new Set(),
    private readonly opts: EngineOptions = {},
  ) {
    this.doc = doc;
    this.sim = new Sim(JSON.stringify(doc), dt, JSON.stringify([...broken]));
    const sim = this.sim;
    // The wiring is fixed for the life of an engine, so node lookups can be remembered.
    const pointCache = new Map<string, number | undefined>();
    const pinNodes = new Map<string, number[]>();
    this.devices = doc.parts.map((p) => {
      const nodes = [...sim.nodes(p.id)];
      pinNodes.set(p.id, nodes.slice(0, defOf(p.type).pins.length));
      const v = new PartView(sim, p, nodes);
      this.byId.set(p.id, v);
      return v;
    });
    this.net = {
      nodeCount: sim.nodeCount,
      hasGround: sim.hasGround,
      autoGroundPart: sim.autoGroundPart ?? null,
      pinNodes,
      pointNode: {
        get(key: string) {
          if (pointCache.has(key)) return pointCache.get(key);
          const [x, y] = key.split(',').map(Number);
          const n = sim.pointNode(x, y);
          pointCache.set(key, n);
          return n;
        },
      },
    };
    this.lu = {
      get reused() {
        return sim.luReused;
      },
    };
    if (opts.watchParams) this.paramsSeen = doc.parts.map((p) => JSON.stringify(p.params));
  }

  get t(): number {
    return this.sim.t;
  }
  get dt(): number {
    return this.sim.dt;
  }
  get n(): number {
    return this.sim.n;
  }
  get x(): Float64Array {
    return this.sim.x();
  }
  get failure(): string | null {
    return this.sim.failure ?? null;
  }
  get roughSteps(): number {
    return this.sim.roughSteps;
  }

  /** Free the core's memory now instead of waiting for garbage collection. */
  dispose(): void {
    this.sim.free();
  }

  private pushChangedParams(): void {
    this.doc.parts.forEach((p, i) => {
      const s = JSON.stringify(p.params);
      if (s === this.paramsSeen[i]) return;
      this.paramsSeen[i] = s;
      for (const [k, v] of Object.entries(p.params)) this.setParam(p.id, k, v);
    });
  }

  setParam(id: string, key: string, value: ParamValue): void {
    this.sim.setParam(id, key, JSON.stringify(value));
  }

  /** Point parts at the edited document's values (values changed, wiring did not). */
  syncParts(doc: CircuitDoc): void {
    this.doc = doc;
    doc.parts.forEach((p) => {
      const v = this.byId.get(p.id);
      if (v) v.part = p;
    });
    this.sim.syncParams(JSON.stringify(doc));
    if (this.opts.watchParams) this.paramsSeen = doc.parts.map((p) => JSON.stringify(p.params));
  }

  /** Advance one time step. Returns parts that were damaged in this step. */
  step(): PartIssue[] {
    if (this.opts.watchParams) this.pushChangedParams();
    return this.sim.step() ? this.takeDamage() : [];
  }

  /** Advance many steps in one call (much faster), recording the watched nodes. */
  run(steps: number): PartIssue[] {
    if (this.opts.watchParams) this.pushChangedParams();
    return this.sim.run(steps) ? this.takeDamage() : [];
  }

  /** Record these nodes during `run`, at most one sample per `minInterval` seconds (node -1 reads 0 V). */
  watch(nodes: number[], minInterval: number): void {
    this.sim.watch(Int32Array.from(nodes), minInterval);
  }

  /** Samples recorded since the last call: times, and one row of values per time. */
  takeTrace(): { t: Float64Array; v: Float64Array } {
    const out = { t: this.sim.traceT(), v: this.sim.traceV() };
    this.sim.clearTrace();
    return out;
  }

  private takeDamage(): PartIssue[] {
    return JSON.parse(this.sim.takeDamage()) as PartIssue[];
  }

  exportState(): Map<string, unknown> {
    return new Map(Object.entries(JSON.parse(this.sim.exportState()) as Record<string, unknown>));
  }

  importState(m: Map<string, unknown>, t: number): void {
    this.sim.importState(JSON.stringify(Object.fromEntries(m)), t);
  }

  volt(node: number): number {
    return this.sim.volt(node);
  }

  reading(partId: string): { v: number; i: number; p: number; extra: Record<string, number> } | null {
    const r = JSON.parse(this.sim.reading(partId)) as { v: number; i: number; p: number; extra: Record<string, number> } | null;
    if (r) r.extra = fromJsonNumbers(JSON.stringify(r.extra));
    return r;
  }

  advice(): PartIssue[] {
    return JSON.parse(this.sim.advice()) as (Issue & { part: string })[];
  }

  wireCurrents(doc: CircuitDoc): Map<string, number> {
    const cur = this.sim.wireCurrents();
    return new Map(doc.wires.map((w, i) => [w.id, cur[i] ?? 0]));
  }

  acSweep(stimulus: string, inNode: number, outNode: number, freqs: number[]): { f: number; db: number; phase: number }[] {
    return JSON.parse(this.sim.acSweep(stimulus, inNode, outNode, Float64Array.from(freqs)));
  }

  /** The circuit doctor's checks on the drawing itself. */
  staticChecks(): DoctorNote[] {
    return JSON.parse(this.sim.staticChecks()) as DoctorNote[];
  }
}

export interface IvCurve {
  label: string;
  pts: { v: number; i: number }[];
}

export interface IvPlot {
  xLabel: string;
  yLabel: string;
  curves: IvCurve[];
}

/** Parts the curve tracer can measure. */
export const canTrace = (type: string): boolean => ['diode', 'zener', 'schottky', 'led', 'photodiode', 'npn', 'pnp', 'nmos', 'pmos'].includes(type);

/** Characteristic curves of a part, measured by the core's curve tracer. */
export function partCurves(part: Part): IvPlot {
  return JSON.parse(traceCurves(part.type, JSON.stringify(part.params))) as IvPlot;
}
