import { LED_COLORS } from '../model/library';
import type { Part } from '../model/types';
import type { Stamper } from './stamper';

/** Thermal voltage at room temperature. */
export const VT = 0.025852;
const GMIN = 1e-12;
export const LOGIC_HIGH = 5;
const LOGIC_ROUT = 100;

export interface Ctx {
  t: number;
  dt: number;
  x: Float64Array;
}

/** Something the circuit doctor should tell the student. */
export interface Issue {
  level: 'burn' | 'warn' | 'info';
  key: string;
  vars?: Record<string, string | number>;
}

const volt = (x: Float64Array, n: number): number => (n < 0 ? 0 : x[n]);
const safeExp = (v: number): number => Math.exp(Math.min(v, 80));

/** SPICE-style junction voltage limiting so Newton's method does not overshoot. */
function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}

function stepLimit(vnew: number, vold: number, max: number): number {
  const d = vnew - vold;
  return Math.abs(d) > max ? vold + Math.sign(d) * max : vnew;
}

export abstract class Device {
  broken = false;
  /** Set during stamp() when the voltage was limited: Newton has not converged yet. */
  limited = false;
  readonly nonlinear: boolean = false;
  /** Currents into each pin after the last accepted step. */
  cur: number[];

  constructor(
    public part: Part,
    public nodes: number[],
  ) {
    this.cur = nodes.map(() => 0);
  }

  num(k: string, fallback = 0): number {
    const v = this.part.params[k];
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : fallback;
  }

  v(x: Float64Array, i: number): number {
    return volt(x, this.nodes[i]);
  }

  abstract stamp(s: Stamper, c: Ctx): void;
  /** Called once the step has converged: update memory and currents. */
  abstract accept(c: Ctx): void;
  /** Damage check after each step. A 'burn' issue breaks the part. */
  limits(_c: Ctx): Issue | null {
    return null;
  }
  /** Advice shown while running (not damage). */
  advice(_x: Float64Array): Issue | null {
    return null;
  }
  /** Extra values for the inspector and the board. */
  extra(): Record<string, number> {
    return {};
  }
  save(): unknown {
    return null;
  }
  load(_s: unknown): void {}
}

// ---------------------------------------------------------------- linear parts

abstract class Conductance extends Device {
  abstract conductance(): number;
  stamp(s: Stamper): void {
    if (!this.broken) s.g(this.nodes[0], this.nodes[1], this.conductance());
  }
  accept(c: Ctx): void {
    const i = this.broken ? 0 : (this.v(c.x, 0) - this.v(c.x, 1)) * this.conductance();
    this.cur = [i, -i];
  }
  power(c: Ctx): number {
    return Math.abs((this.v(c.x, 0) - this.v(c.x, 1)) * this.cur[0]);
  }
}

class Resistor extends Conductance {
  conductance(): number {
    return 1 / Math.max(this.num('R', 1000), 1e-3);
  }
  limits(c: Ctx): Issue | null {
    const p = this.power(c);
    const max = this.num('Pmax', 0.25);
    return p > 2 * max ? { level: 'burn', key: 'burn.resistor', vars: { p, max } } : null;
  }
  advice(x: Float64Array): Issue | null {
    const p = Math.abs((this.v(x, 0) - this.v(x, 1)) * this.cur[0]);
    const max = this.num('Pmax', 0.25);
    return p > max ? { level: 'warn', key: 'warn.resistorHot', vars: { p, max } } : null;
  }
  extra(): Record<string, number> {
    return {};
  }
}

class Lamp extends Conductance {
  conductance(): number {
    const v = this.num('V', 12);
    const p = Math.max(this.num('P', 5), 1e-3);
    return p / (v * v);
  }
  brightness = 0;
  accept(c: Ctx): void {
    super.accept(c);
    this.brightness = this.power(c) / this.num('P', 5);
  }
  limits(c: Ctx): Issue | null {
    const p = this.power(c);
    const max = this.num('P', 5);
    return p > 2 * max ? { level: 'burn', key: 'burn.lamp', vars: { p, max, v: this.num('V', 12) } } : null;
  }
  extra(): Record<string, number> {
    return { brightness: this.brightness };
  }
}

class Switch extends Conductance {
  conductance(): number {
    return Number(this.part.params.closed) === 1 ? 1e3 : 0;
  }
}

class Fuse extends Conductance {
  conductance(): number {
    return 100;
  }
  limits(): Issue | null {
    const max = this.num('I', 1);
    return Math.abs(this.cur[0]) > max ? { level: 'burn', key: 'burn.fuse', vars: { i: Math.abs(this.cur[0]), max } } : null;
  }
}

class Pot extends Device {
  r(): [number, number] {
    const R = Math.max(this.num('R', 1e4), 1);
    const pos = Math.min(1, Math.max(0, this.num('pos', 0.5)));
    return [Math.max(R * pos, 0.5), Math.max(R * (1 - pos), 0.5)];
  }
  stamp(s: Stamper): void {
    const [r1, r2] = this.r();
    s.g(this.nodes[0], this.nodes[2], 1 / r1);
    s.g(this.nodes[2], this.nodes[1], 1 / r2);
  }
  accept(c: Ctx): void {
    const [r1, r2] = this.r();
    const va = this.v(c.x, 0);
    const vb = this.v(c.x, 1);
    const vw = this.v(c.x, 2);
    const ia = (va - vw) / r1;
    const ib = (vb - vw) / r2;
    this.cur = [ia, ib, -(ia + ib)];
  }
}

// ---------------------------------------------------------------- sources

class Battery extends Device {
  emf(_t: number): number {
    return this.num('V', 9);
  }
  rint(): number {
    return Math.max(this.num('r', 0.1), 1e-3);
  }
  stamp(s: Stamper, c: Ctx): void {
    const g = 1 / this.rint();
    const [p, n] = this.nodes;
    s.g(p, n, g);
    s.flow(n, p, this.emf(c.t) * g);
  }
  accept(c: Ctx): void {
    const i = (this.v(c.x, 0) - this.v(c.x, 1) - this.emf(c.t)) / this.rint();
    this.cur = [i, -i];
  }
  advice(): Issue | null {
    const delivered = Math.abs(this.cur[0]);
    const short = Math.abs(this.emf(0) || this.num('Vp', 0)) / this.rint();
    return short > 0 && delivered > 0.5 * short ? { level: 'warn', key: 'warn.short', vars: { i: delivered } } : null;
  }
}

class AcSource extends Battery {
  emf(t: number): number {
    return this.num('Vp', 12) * Math.sin(2 * Math.PI * this.num('f', 50) * t);
  }
  advice(): Issue | null {
    const short = this.num('Vp', 12) / this.rint();
    return Math.abs(this.cur[0]) > 0.5 * short ? { level: 'warn', key: 'warn.short', vars: { i: Math.abs(this.cur[0]) } } : null;
  }
}

class FuncGen extends Battery {
  emf(t: number): number {
    const vp = this.num('Vp', 2);
    const f = Math.max(this.num('f', 100), 1e-3);
    const phase = (t * f) % 1;
    let w: number;
    switch (this.part.params.wave) {
      case 'square':
        w = phase < 0.5 ? 1 : -1;
        break;
      case 'triangle':
        w = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
        break;
      default:
        w = Math.sin(2 * Math.PI * phase);
    }
    return this.num('offset', 0) + vp * w;
  }
  advice(): Issue | null {
    return null;
  }
}

// ---------------------------------------------------------------- energy storage

class Capacitor extends Device {
  vPrev = 0;
  constructor(
    part: Part,
    nodes: number[],
    readonly polarized: boolean,
  ) {
    super(part, nodes);
  }
  gc(dt: number): number {
    return Math.max(this.num('C', 1e-6), 1e-15) / dt;
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const g = this.gc(c.dt);
    s.g(this.nodes[0], this.nodes[1], g);
    s.flow(this.nodes[0], this.nodes[1], -g * this.vPrev);
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0];
      return;
    }
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    const i = this.gc(c.dt) * (v - this.vPrev);
    this.vPrev = v;
    this.cur = [i, -i];
  }
  limits(): Issue | null {
    if (this.polarized && this.vPrev < -1.5) return { level: 'burn', key: 'burn.ecapReverse', vars: { v: -this.vPrev } };
    const max = this.num('Vmax', 50);
    if (Math.abs(this.vPrev) > 1.2 * max) return { level: 'burn', key: 'burn.capVoltage', vars: { v: Math.abs(this.vPrev), max } };
    return null;
  }
  save(): unknown {
    return this.vPrev;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.vPrev = s;
  }
}

class Inductor extends Device {
  iPrev = 0;
  coef(dt: number): { g: number; k: number } {
    const L = Math.max(this.num('L', 0.01), 1e-12);
    const R = Math.max(this.num('Rs', 1), 1e-6);
    const g = 1 / (R + L / dt);
    return { g, k: g * (L / dt) };
  }
  stamp(s: Stamper, c: Ctx): void {
    const { g, k } = this.coef(c.dt);
    s.g(this.nodes[0], this.nodes[1], g);
    s.flow(this.nodes[0], this.nodes[1], k * this.iPrev);
  }
  accept(c: Ctx): void {
    const { g, k } = this.coef(c.dt);
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    this.iPrev = g * v + k * this.iPrev;
    this.cur = [this.iPrev, -this.iPrev];
  }
  save(): unknown {
    return this.iPrev;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.iPrev = s;
  }
}

// ---------------------------------------------------------------- diodes

type DiodeKind = 'diode' | 'schottky' | 'zener' | 'led';

class Diode extends Device {
  readonly nonlinear = true;
  vLast = 0;
  constructor(
    part: Part,
    nodes: number[],
    readonly kind: DiodeKind,
  ) {
    super(part, nodes);
  }
  model(): { Is: number; nvt: number; vz: number; ibv: number } {
    switch (this.kind) {
      case 'schottky':
        return { Is: 1e-6, nvt: 1.05 * VT, vz: 0, ibv: 0 };
      case 'zener':
        return { Is: 2.5e-9, nvt: 1.75 * VT, vz: Math.max(this.num('Vz', 5.1), 0.5), ibv: 5e-3 };
      case 'led': {
        const vf = LED_COLORS[String(this.part.params.color)]?.vf ?? 1.8;
        const nvt = 2 * VT;
        return { Is: 0.01 / Math.exp(vf / nvt), nvt, vz: 0, ibv: 0 };
      }
      default:
        return { Is: 2.5e-9, nvt: 1.75 * VT, vz: 0, ibv: 0 };
    }
  }
  iv(v: number): [number, number] {
    const { Is, nvt, vz, ibv } = this.model();
    const e = safeExp(v / nvt);
    let I = Is * (e - 1);
    let g = (Is * e) / nvt;
    if (vz > 0) {
      const ez = safeExp(-(v + vz) / nvt);
      I -= ibv * ez;
      g += (ibv * ez) / nvt;
    }
    return [I, g];
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const { Is, nvt, vz, ibv } = this.model();
    const raw = this.v(c.x, 0) - this.v(c.x, 1);
    let v: number;
    if (vz > 0 && raw < -vz / 2) {
      const vcritZ = nvt * Math.log(nvt / (Math.SQRT2 * ibv));
      v = -pnjlim(-(raw + vz), -(this.vLast + vz), nvt, vcritZ) - vz;
    } else {
      v = pnjlim(raw, this.vLast, nvt, nvt * Math.log(nvt / (Math.SQRT2 * Is)));
    }
    this.limited = Math.abs(v - raw) > 1e-9;
    this.vLast = v;
    const [I, g] = this.iv(v);
    const [a, k] = this.nodes;
    s.g(a, k, g + GMIN);
    s.flow(a, k, I - g * v);
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0];
      return;
    }
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    this.vLast = v;
    const i = this.iv(v)[0] + GMIN * v;
    this.cur = [i, -i];
  }
  limits(): Issue | null {
    const i = this.cur[0];
    if (this.kind === 'led') {
      const max = this.num('Imax', 0.02);
      return i > 3 * max ? { level: 'burn', key: 'burn.led', vars: { i, max } } : null;
    }
    if (this.kind === 'zener') {
      const p = Math.abs(i * this.vLast);
      const max = this.num('Pmax', 0.5);
      return p > 2 * max ? { level: 'burn', key: 'burn.zener', vars: { p, max } } : null;
    }
    const max = this.num('Imax', 1);
    return Math.abs(i) > 2 * max ? { level: 'burn', key: 'burn.diode', vars: { i: Math.abs(i), max } } : null;
  }
  advice(): Issue | null {
    if (this.kind !== 'led') return null;
    const max = this.num('Imax', 0.02);
    if (this.cur[0] > 1.5 * max) return { level: 'warn', key: 'warn.ledHigh', vars: { i: this.cur[0], max } };
    if (this.vLast < -1) return { level: 'info', key: 'info.ledReverse' };
    return null;
  }
  extra(): Record<string, number> {
    return this.kind === 'led' ? { brightness: Math.max(0, this.cur[0]) / this.num('Imax', 0.02) } : {};
  }
  save(): unknown {
    return this.vLast;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.vLast = s;
  }
}

// ---------------------------------------------------------------- transistors

class Bjt extends Device {
  readonly nonlinear = true;
  vbe = 0;
  vbc = 0;
  readonly Is = 1e-14;
  readonly betaR = 1;
  constructor(
    part: Part,
    nodes: number[],
    readonly pol: 1 | -1,
  ) {
    super(part, nodes);
  }
  eval(vbe: number, vbc: number) {
    const { Is, betaR } = this;
    const bf = Math.max(this.num('beta', 100), 1);
    const ef = safeExp(vbe / VT);
    const er = safeExp(vbc / VT);
    const If = Is * (ef - 1);
    const Ir = Is * (er - 1);
    const gf = (Is * ef) / VT + GMIN;
    const gr = (Is * er) / VT + GMIN;
    return {
      Ic: If - Ir - Ir / betaR,
      Ib: If / bf + Ir / betaR,
      dIc: [gf, -gr * (1 + 1 / betaR)],
      dIb: [gf / bf, gr / betaR],
    };
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const p = this.pol;
    const [B, C, E] = this.nodes;
    const vb = volt(c.x, B);
    const rawBe = p * (vb - volt(c.x, E));
    const rawBc = p * (vb - volt(c.x, C));
    const vcrit = VT * Math.log(VT / (Math.SQRT2 * this.Is));
    const vbe = pnjlim(rawBe, this.vbe, VT, vcrit);
    const vbc = pnjlim(rawBc, this.vbc, VT, vcrit);
    this.limited = Math.abs(vbe - rawBe) + Math.abs(vbc - rawBc) > 1e-9;
    this.vbe = vbe;
    this.vbc = vbc;
    const m = this.eval(vbe, vbc);
    const dIe = [-(m.dIc[0] + m.dIb[0]), -(m.dIc[1] + m.dIb[1])];
    // Terminal order C, B, E. Actual current = p·f(p·ΔV), so derivatives keep their sign.
    s.lin(
      [C, B, E],
      [p * m.Ic, p * m.Ib, -p * (m.Ic + m.Ib)],
      [
        [B, E, p * vbe],
        [B, C, p * vbc],
      ],
      [m.dIc, m.dIb, dIe],
    );
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0, 0];
      return;
    }
    const p = this.pol;
    const [B, C, E] = this.nodes;
    const vb = volt(c.x, B);
    this.vbe = p * (vb - volt(c.x, E));
    this.vbc = p * (vb - volt(c.x, C));
    const m = this.eval(this.vbe, this.vbc);
    this.cur = [p * m.Ib, p * m.Ic, -p * (m.Ib + m.Ic)];
  }
  limits(): Issue | null {
    const ib = Math.abs(this.cur[0]);
    if (ib > 0.1) return { level: 'burn', key: 'burn.base', vars: { i: ib } };
    const vce = this.vbe - this.vbc;
    const pw = Math.abs(this.cur[1] * vce) + Math.abs(this.cur[0] * this.vbe);
    const max = this.num('Pmax', 0.5);
    return pw > 2 * max ? { level: 'burn', key: 'burn.transistor', vars: { p: pw, max } } : null;
  }
  extra(): Record<string, number> {
    return { vbe: this.pol * this.vbe, vce: this.pol * (this.vbe - this.vbc), ib: this.cur[0], ic: this.cur[1] };
  }
  save(): unknown {
    return [this.vbe, this.vbc];
  }
  load(s: unknown): void {
    if (Array.isArray(s)) [this.vbe, this.vbc] = s as [number, number];
  }
}

class Mosfet extends Device {
  readonly nonlinear = true;
  vgs = 0;
  vds = 0;
  readonly lambda = 0.02;
  constructor(
    part: Part,
    nodes: number[],
    readonly pol: 1 | -1,
  ) {
    super(part, nodes);
  }
  /** Drain current and its derivatives, for vds >= 0 (n-channel sense). */
  eval(vgs: number, vds: number): { id: number; gm: number; gds: number } {
    const K = Math.max(this.num('K', 0.1), 1e-9);
    const vov = vgs - Math.max(this.num('Vth', 2), 0.01);
    const lam = this.lambda;
    if (vov <= 0) return { id: 0, gm: 0, gds: GMIN };
    if (vds < vov) {
      const base = vov * vds - (vds * vds) / 2;
      return {
        id: K * base * (1 + lam * vds),
        gm: K * vds * (1 + lam * vds),
        gds: K * (vov - vds) * (1 + lam * vds) + K * base * lam + GMIN,
      };
    }
    return { id: (K / 2) * vov * vov * (1 + lam * vds), gm: K * vov * (1 + lam * vds), gds: (K / 2) * vov * vov * lam + GMIN };
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const p = this.pol;
    const [G, D, S] = this.nodes;
    const vg = volt(c.x, G);
    const vd = volt(c.x, D);
    const vs = volt(c.x, S);
    const rawGs = p * (vg - vs);
    const rawDs = p * (vd - vs);
    const vgs = stepLimit(rawGs, this.vgs, 1);
    const vds = stepLimit(rawDs, this.vds, 2);
    this.limited = Math.abs(vgs - rawGs) + Math.abs(vds - rawDs) > 1e-9;
    this.vgs = vgs;
    this.vds = vds;
    // When vds < 0 the device is symmetric: swap drain and source.
    const rev = vds < 0;
    const dNode = rev ? S : D;
    const sNode = rev ? D : S;
    const vgsE = rev ? vgs - vds : vgs;
    const vdsE = rev ? -vds : vds;
    const m = this.eval(vgsE, vdsE);
    s.lin(
      [dNode, sNode],
      [p * m.id, -p * m.id],
      [
        [G, sNode, p * vgsE],
        [dNode, sNode, p * vdsE],
      ],
      [
        [m.gm, m.gds],
        [-m.gm, -m.gds],
      ],
    );
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0, 0];
      return;
    }
    const p = this.pol;
    const [G, D, S] = this.nodes;
    this.vgs = p * (volt(c.x, G) - volt(c.x, S));
    this.vds = p * (volt(c.x, D) - volt(c.x, S));
    const rev = this.vds < 0;
    const m = this.eval(rev ? this.vgs - this.vds : this.vgs, Math.abs(this.vds));
    const id = p * (rev ? -m.id : m.id);
    this.cur = [0, id, -id];
  }
  extra(): Record<string, number> {
    return { vgs: this.pol * this.vgs, vds: this.pol * this.vds, id: this.cur[1] };
  }
  save(): unknown {
    return [this.vgs, this.vds];
  }
  load(s: unknown): void {
    if (Array.isArray(s)) [this.vgs, this.vds] = s as [number, number];
  }
}

// ---------------------------------------------------------------- logic

/** Reads a logic level with TTL thresholds; in-between voltages keep the previous level. */
function level(v: number, prev: number): number {
  if (v >= 2) return 1;
  if (v <= 0.8) return 0;
  return prev;
}

const GATE_FN: Record<string, (a: number, b: number) => number> = {
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  not: (a) => 1 - a,
  nand: (a, b) => 1 - (a & b),
  nor: (a, b) => 1 - (a | b),
  xor: (a, b) => a ^ b,
  xnor: (a, b) => 1 - (a ^ b),
};

/** A logic output: 0 V or 5 V behind 100 Ω, like a real TTL output. */
abstract class LogicDriver extends Device {
  out = 0;
  abstract outPin(): number;
  stampOut(s: Stamper): void {
    const g = 1 / LOGIC_ROUT;
    const o = this.nodes[this.outPin()];
    s.g(o, -1, g);
    s.flow(-1, o, this.out * LOGIC_HIGH * g);
  }
  outCurrent(x: Float64Array): number {
    return (this.v(x, this.outPin()) - this.out * LOGIC_HIGH) / LOGIC_ROUT;
  }
}

class Gate extends LogicDriver {
  inLevels: number[] = [0, 0];
  constructor(
    part: Part,
    nodes: number[],
    readonly fn: string,
  ) {
    super(part, nodes);
    this.out = GATE_FN[fn](0, 0);
  }
  outPin(): number {
    return this.nodes.length - 1;
  }
  stamp(s: Stamper): void {
    this.stampOut(s);
    for (let i = 0; i < this.nodes.length - 1; i++) s.g(this.nodes[i], -1, 1e-6);
  }
  accept(c: Ctx): void {
    const n = this.nodes.length - 1;
    const cur: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = this.v(c.x, i);
      this.inLevels[i] = level(v, this.inLevels[i]);
      cur.push(v * 1e-6);
    }
    cur.push(this.outCurrent(c.x));
    this.cur = cur;
    // The new output takes effect on the next step: a small, realistic propagation delay.
    this.out = GATE_FN[this.fn](this.inLevels[0], this.inLevels[1] ?? 0);
  }
  extra(): Record<string, number> {
    return { out: this.out };
  }
  save(): unknown {
    return [this.out, ...this.inLevels];
  }
  load(s: unknown): void {
    if (Array.isArray(s)) [this.out, ...this.inLevels] = s as number[];
  }
}

class LogicIn extends LogicDriver {
  outPin(): number {
    return 0;
  }
  stamp(s: Stamper): void {
    this.out = Number(this.part.params.state) === 1 ? 1 : 0;
    this.stampOut(s);
  }
  accept(c: Ctx): void {
    this.cur = [this.outCurrent(c.x)];
  }
  extra(): Record<string, number> {
    return { out: this.out };
  }
}

class LogicOut extends Device {
  lvl = 0;
  stamp(s: Stamper): void {
    s.g(this.nodes[0], -1, 1e-6);
  }
  accept(c: Ctx): void {
    const v = this.v(c.x, 0);
    this.lvl = level(v, this.lvl);
    this.cur = [v * 1e-6];
  }
  extra(): Record<string, number> {
    return { level: this.lvl };
  }
}

// ---------------------------------------------------------------- meters

abstract class Meter extends Device {
  mean = 0;
  meanSq = 0;
  started = false;
  abstract sample(x: Float64Array): number;
  track(c: Ctx): void {
    const s = this.sample(c.x);
    if (!this.started) {
      this.mean = s;
      this.meanSq = s * s;
      this.started = true;
      return;
    }
    const a = Math.min(1, c.dt / 0.04);
    this.mean += a * (s - this.mean);
    this.meanSq += a * (s * s - this.meanSq);
  }
  reading(): number {
    return this.part.params.mode === 'ac' ? Math.sqrt(Math.max(0, this.meanSq - this.mean * this.mean)) : this.mean;
  }
  extra(): Record<string, number> {
    return { reading: this.reading() };
  }
  save(): unknown {
    return [this.mean, this.meanSq, this.started];
  }
  load(s: unknown): void {
    if (Array.isArray(s)) [this.mean, this.meanSq, this.started] = s as [number, number, boolean];
  }
}

class Voltmeter extends Meter {
  stamp(s: Stamper): void {
    s.g(this.nodes[0], this.nodes[1], 1e-7);
  }
  sample(x: Float64Array): number {
    return this.v(x, 0) - this.v(x, 1);
  }
  accept(c: Ctx): void {
    const i = this.sample(c.x) * 1e-7;
    this.cur = [i, -i];
    this.track(c);
  }
}

class Ammeter extends Meter {
  stamp(s: Stamper): void {
    if (!this.broken) s.g(this.nodes[0], this.nodes[1], 100);
  }
  sample(): number {
    return this.cur[0];
  }
  accept(c: Ctx): void {
    const i = this.broken ? 0 : (this.v(c.x, 0) - this.v(c.x, 1)) * 100;
    this.cur = [i, -i];
    this.track(c);
  }
  limits(): Issue | null {
    return Math.abs(this.cur[0]) > 10 ? { level: 'burn', key: 'burn.ammeter', vars: { i: Math.abs(this.cur[0]) } } : null;
  }
}

class Probe extends Device {
  value = 0;
  stamp(): void {}
  accept(c: Ctx): void {
    this.value = this.v(c.x, 0);
  }
  extra(): Record<string, number> {
    return { v: this.value };
  }
}

class Nothing extends Device {
  stamp(): void {}
  accept(): void {}
}

export function createDevice(part: Part, nodes: number[]): Device {
  switch (part.type) {
    case 'resistor':
      return new Resistor(part, nodes);
    case 'lamp':
      return new Lamp(part, nodes);
    case 'switch':
    case 'button':
      return new Switch(part, nodes);
    case 'fuse':
      return new Fuse(part, nodes);
    case 'pot':
      return new Pot(part, nodes);
    case 'battery':
      return new Battery(part, nodes);
    case 'ac':
      return new AcSource(part, nodes);
    case 'funcgen':
      return new FuncGen(part, nodes);
    case 'capacitor':
      return new Capacitor(part, nodes, false);
    case 'ecap':
      return new Capacitor(part, nodes, true);
    case 'inductor':
      return new Inductor(part, nodes);
    case 'diode':
    case 'schottky':
    case 'zener':
    case 'led':
      return new Diode(part, nodes, part.type);
    case 'npn':
      return new Bjt(part, nodes, 1);
    case 'pnp':
      return new Bjt(part, nodes, -1);
    case 'nmos':
      return new Mosfet(part, nodes, 1);
    case 'pmos':
      return new Mosfet(part, nodes, -1);
    case 'logicin':
      return new LogicIn(part, nodes);
    case 'logicout':
      return new LogicOut(part, nodes);
    case 'voltmeter':
      return new Voltmeter(part, nodes);
    case 'ammeter':
      return new Ammeter(part, nodes);
    case 'probe':
      return new Probe(part, nodes);
    default:
      if (part.type in GATE_FN) return new Gate(part, nodes, part.type);
      return new Nothing(part, nodes);
  }
}
