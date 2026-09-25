import { LED_COLORS } from '../model/library';
import type { Part } from '../model/types';
import type { AcStamper } from './ac';
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

/** One PN junction (Shockley diode) with voltage limiting; building block for diodes, LEDs, SCRs. */
class Junction {
  vLast = 0;
  constructor(
    public Is: number,
    public nvt: number,
  ) {}
  iv(v: number): [number, number] {
    const e = safeExp(v / this.nvt);
    return [this.Is * (e - 1), (this.Is * e) / this.nvt + GMIN];
  }
  /** Stamps the linearised junction from a to k. Returns true if the voltage had to be limited. */
  stamp(s: Stamper, a: number, k: number, raw: number): boolean {
    const vcrit = this.nvt * Math.log(this.nvt / (Math.SQRT2 * this.Is));
    const v = pnjlim(raw, this.vLast, this.nvt, vcrit);
    this.vLast = v;
    const [I, g] = this.iv(v);
    s.g(a, k, g);
    s.flow(a, k, I - g * v);
    return Math.abs(v - raw) > 1e-9;
  }
  current(v: number): number {
    return this.iv(v)[0] + GMIN * v;
  }
  /** Small-signal conductance at the last operating point. */
  g(): number {
    return this.iv(this.vLast)[1];
  }
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
  /** Small-signal admittance at angular frequency w, for the Bode plotter. Default: no connection. */
  ac(_s: AcStamper, _w: number): void {}
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
  ac(s: AcStamper): void {
    if (!this.broken) s.y(this.nodes[0], this.nodes[1], this.conductance());
  }
  power(c: Ctx): number {
    return Math.abs((this.v(c.x, 0) - this.v(c.x, 1)) * this.cur[0]);
  }
}

/**
 * Parts that heat up: damage follows the average power (like a real filament or resistor body),
 * so an AC peak of twice the average is not mistaken for overload.
 */
abstract class Heating extends Conductance {
  pAvg = 0;
  pNow = 0;
  accept(c: Ctx): void {
    super.accept(c);
    this.pNow = this.power(c);
    this.pAvg += (this.pNow - this.pAvg) * Math.min(1, c.dt / 0.05);
  }
  overloaded(max: number): boolean {
    return this.pAvg > 2 * max || this.pNow > 20 * max;
  }
  save(): unknown {
    return this.pAvg;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.pAvg = s;
  }
}

class Resistor extends Heating {
  conductance(): number {
    return 1 / Math.max(this.num('R', 1000), 1e-3);
  }
  limits(): Issue | null {
    const max = this.num('Pmax', 0.25);
    return this.overloaded(max) ? { level: 'burn', key: 'burn.resistor', vars: { p: Math.max(this.pAvg, this.pNow), max } } : null;
  }
  advice(): Issue | null {
    const max = this.num('Pmax', 0.25);
    return this.pAvg > max ? { level: 'warn', key: 'warn.resistorHot', vars: { p: this.pAvg, max } } : null;
  }
  extra(): Record<string, number> {
    return { heat: this.pAvg / Math.max(this.num('Pmax', 0.25), 1e-9) };
  }
}

class Ldr extends Conductance {
  resistance(): number {
    const dark = Math.max(this.num('Rdark', 1e6), 1);
    const lit = Math.max(this.num('Rlight', 500), 1);
    const k = Math.min(1, Math.max(0, this.num('light', 0.5)));
    return dark * Math.pow(lit / dark, k);
  }
  conductance(): number {
    return 1 / this.resistance();
  }
  extra(): Record<string, number> {
    return { r: this.resistance() };
  }
}

class Lamp extends Heating {
  conductance(): number {
    const v = this.num('V', 12);
    const p = Math.max(this.num('P', 5), 1e-3);
    return p / (v * v);
  }
  limits(): Issue | null {
    const max = this.num('P', 5);
    return this.overloaded(max) ? { level: 'burn', key: 'burn.lamp', vars: { p: Math.max(this.pAvg, this.pNow), max, v: this.num('V', 12) } } : null;
  }
  extra(): Record<string, number> {
    return { brightness: this.pAvg / this.num('P', 5) };
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
  ac(s: AcStamper): void {
    const [r1, r2] = this.r();
    s.y(this.nodes[0], this.nodes[2], 1 / r1);
    s.y(this.nodes[2], this.nodes[1], 1 / r2);
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
  ac(s: AcStamper): void {
    const g = 1 / this.rint();
    s.y(this.nodes[0], this.nodes[1], g);
    if (s.stimulus === this.part.id) s.flow(this.nodes[1], this.nodes[0], g);
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
    const fm = Math.max(this.num('fm', 100), 1e-3);
    const phase = (t * f) % 1;
    const TAU = 2 * Math.PI;
    let w: number;
    switch (this.part.params.wave) {
      case 'square':
        w = phase < 0.5 ? 1 : -1;
        break;
      case 'triangle':
        w = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
        break;
      case 'pulse':
        w = phase < this.num('duty', 0.5) ? 1 : 0;
        break;
      case 'pwm':
        w = phase < 0.5 + 0.45 * Math.sin(TAU * fm * t) ? 1 : 0;
        break;
      case 'am':
        w = (1 + this.num('m', 0.5) * Math.sin(TAU * fm * t)) * Math.sin(TAU * f * t);
        break;
      case 'fm':
        w = Math.sin(TAU * f * t + (this.num('dev', 50) / fm) * Math.sin(TAU * fm * t));
        break;
      default:
        w = Math.sin(TAU * phase);
    }
    return this.num('offset', 0) + vp * w;
  }
  advice(): Issue | null {
    return null;
  }
}

/** Bench power supply: constant voltage until the load asks for more than the current limit. */
class PowerSupply extends Device {
  readonly nonlinear = true;
  cc = false;
  private flips = 0;
  readonly r = 0.01;
  set(): { V: number; I: number } {
    return { V: Math.min(30, Math.max(0, this.num('V', 12))), I: Math.max(1e-3, this.num('Ilim', 1)) };
  }
  stamp(s: Stamper, c: Ctx): void {
    const { V, I } = this.set();
    const [p, n] = this.nodes;
    const vout = this.v(c.x, 0) - this.v(c.x, 1);
    let cc = this.cc;
    if (!cc && (V - vout) / this.r > I * 1.0001) cc = true;
    else if (cc && vout > V) cc = false;
    if (cc !== this.cc && this.flips < 8) {
      this.cc = cc;
      this.flips++;
      this.limited = true;
    }
    if (this.cc) {
      s.g(p, n, 1e-6);
      s.flow(n, p, I);
    } else {
      s.g(p, n, 1 / this.r);
      s.flow(n, p, V / this.r);
    }
  }
  accept(c: Ctx): void {
    this.flips = 0;
    const { V, I } = this.set();
    const vout = this.v(c.x, 0) - this.v(c.x, 1);
    const i = this.cc ? vout * 1e-6 - I : (vout - V) / this.r;
    this.cur = [i, -i];
  }
  ac(s: AcStamper): void {
    s.y(this.nodes[0], this.nodes[1], this.cc ? 1e-6 : 1 / this.r);
  }
  extra(): Record<string, number> {
    return { cc: this.cc ? 1 : 0, iout: -this.cur[0] };
  }
  save(): unknown {
    return this.cc;
  }
  load(s: unknown): void {
    if (typeof s === 'boolean') this.cc = s;
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
  cap(): number {
    return Math.max(this.num('C', 1e-6), 1e-15);
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const g = this.cap() / c.dt;
    s.g(this.nodes[0], this.nodes[1], g);
    s.flow(this.nodes[0], this.nodes[1], -g * this.vPrev);
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0];
      return;
    }
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    const i = (this.cap() / c.dt) * (v - this.vPrev);
    this.vPrev = v;
    this.cur = [i, -i];
  }
  ac(s: AcStamper, w: number): void {
    if (!this.broken) s.y(this.nodes[0], this.nodes[1], 0, w * this.cap());
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
  lr(): { L: number; R: number } {
    return { L: Math.max(this.num('L', 0.01), 1e-12), R: Math.max(this.num('Rs', 1), 1e-6) };
  }
  coef(dt: number): { g: number; k: number } {
    const { L, R } = this.lr();
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
  ac(s: AcStamper, w: number): void {
    const { L, R } = this.lr();
    const den = R * R + w * w * L * L;
    s.y(this.nodes[0], this.nodes[1], R / den, (-w * L) / den);
  }
  save(): unknown {
    return this.iPrev;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.iPrev = s;
  }
}

/** Two coupled coils (k = 0.999). Currents are the energy-storage state, like an inductor's. */
class Transformer extends Device {
  i1 = 0;
  i2 = 0;
  inv(): { a: number; b: number; d: number } {
    const n = Math.max(this.num('n', 10), 0.01);
    const L1 = Math.max(this.num('L1', 10), 1e-9);
    const L2 = L1 / (n * n);
    const M = 0.999 * Math.sqrt(L1 * L2);
    const det = L1 * L2 - M * M;
    // Inverse inductance matrix [[a, b], [b, d]].
    return { a: L2 / det, b: -M / det, d: L1 / det };
  }
  stamp(s: Stamper, c: Ctx): void {
    const { a, b, d } = this.inv();
    const dt = c.dt;
    const [p1, p2, s1, s2] = this.nodes;
    const v1 = this.v(c.x, 0) - this.v(c.x, 1);
    const v2 = this.v(c.x, 2) - this.v(c.x, 3);
    const I1 = dt * (a * v1 + b * v2) + this.i1;
    const I2 = dt * (b * v1 + d * v2) + this.i2;
    s.lin(
      [p1, p2, s1, s2],
      [I1, -I1, I2, -I2],
      [
        [p1, p2, v1],
        [s1, s2, v2],
      ],
      [
        [dt * a, dt * b],
        [-dt * a, -dt * b],
        [dt * b, dt * d],
        [-dt * b, -dt * d],
      ],
    );
  }
  accept(c: Ctx): void {
    const { a, b, d } = this.inv();
    const v1 = this.v(c.x, 0) - this.v(c.x, 1);
    const v2 = this.v(c.x, 2) - this.v(c.x, 3);
    this.i1 += c.dt * (a * v1 + b * v2);
    this.i2 += c.dt * (b * v1 + d * v2);
    this.cur = [this.i1, -this.i1, this.i2, -this.i2];
  }
  ac(s: AcStamper, w: number): void {
    const { a, b, d } = this.inv();
    const [p1, p2, s1, s2] = this.nodes;
    // Y = Γ / (jω) = −j·Γ/ω
    const k = -1 / w;
    s.trans(p1, p1, p2, 0, k * a);
    s.trans(p1, s1, s2, 0, k * b);
    s.trans(p2, p1, p2, 0, -k * a);
    s.trans(p2, s1, s2, 0, -k * b);
    s.trans(s1, p1, p2, 0, k * b);
    s.trans(s1, s1, s2, 0, k * d);
    s.trans(s2, p1, p2, 0, -k * b);
    s.trans(s2, s1, s2, 0, -k * d);
  }
  limits(): Issue | null {
    return Math.abs(this.i1) > 20 ? { level: 'burn', key: 'burn.transformer', vars: { i: Math.abs(this.i1) } } : null;
  }
  extra(): Record<string, number> {
    return { i1: this.i1, i2: this.i2 };
  }
  save(): unknown {
    return [this.i1, this.i2];
  }
  load(s: unknown): void {
    if (Array.isArray(s)) [this.i1, this.i2] = s as [number, number];
  }
}

// ---------------------------------------------------------------- diodes

type DiodeKind = 'diode' | 'schottky' | 'zener' | 'led' | 'photodiode';

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
      case 'led':
        return ledModel(String(this.part.params.color));
      default:
        return { Is: 2.5e-9, nvt: 1.75 * VT, vz: 0, ibv: 0 };
    }
  }
  /** Reverse current made by light (photodiode only). */
  photo(): number {
    return this.kind === 'photodiode' ? Math.min(1, Math.max(0, this.num('light', 0.5))) * this.num('Isc', 100e-6) : 0;
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
    const ph = this.photo();
    if (ph) s.flow(k, a, ph);
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0];
      return;
    }
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    this.vLast = v;
    const i = this.iv(v)[0] + GMIN * v - this.photo();
    this.cur = [i, -i];
  }
  ac(s: AcStamper): void {
    if (!this.broken) s.y(this.nodes[0], this.nodes[1], this.iv(this.vLast)[1] + GMIN);
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

function ledModel(color: string): { Is: number; nvt: number; vz: number; ibv: number } {
  const vf = LED_COLORS[color]?.vf ?? 1.8;
  const nvt = 2 * VT;
  return { Is: 0.01 / Math.exp(vf / nvt), nvt, vz: 0, ibv: 0 };
}

/**
 * SCR and triac. The gate is a junction to the cathode (MT1); the main path is either blocking
 * (tiny leakage) or conducting like a diode (two opposed diodes for the triac).
 * It latches on when gate current exceeds Igt and switches off below the holding current.
 */
class Thyristor extends Device {
  readonly nonlinear = true;
  on = false;
  private gateF = new Junction(1e-14, VT);
  private gateR = new Junction(1e-14, VT);
  private mainF = new Junction(1e-10, 1.6 * VT);
  private mainR = new Junction(1e-10, 1.6 * VT);
  constructor(
    part: Part,
    nodes: number[],
    readonly bidirectional: boolean,
  ) {
    super(part, nodes);
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const [A, K, G] = this.nodes;
    const vak = this.v(c.x, 0) - this.v(c.x, 1);
    const vgk = this.v(c.x, 2) - this.v(c.x, 1);
    let lim = this.gateF.stamp(s, G, K, vgk);
    if (this.bidirectional) lim = this.gateR.stamp(s, K, G, -vgk) || lim;
    if (this.on) {
      lim = this.mainF.stamp(s, A, K, vak) || lim;
      if (this.bidirectional) lim = this.mainR.stamp(s, K, A, -vak) || lim;
    } else {
      s.g(A, K, 1e-7);
    }
    this.limited = lim;
  }
  accept(c: Ctx): void {
    if (this.broken) {
      this.cur = [0, 0, 0];
      return;
    }
    const vak = this.v(c.x, 0) - this.v(c.x, 1);
    const vgk = this.v(c.x, 2) - this.v(c.x, 1);
    const ig = this.gateF.current(vgk) - (this.bidirectional ? this.gateR.current(-vgk) : 0);
    const iak = this.on ? this.mainF.current(vak) - (this.bidirectional ? this.mainR.current(-vak) : 0) : vak * 1e-7;
    this.cur = [iak, -(iak + ig), ig];
    const Igt = this.num('Igt', 0.001);
    const Ih = this.num('Ih', 0.005);
    if (!this.on) {
      const fires = this.bidirectional ? Math.abs(ig) > Igt && Math.abs(vak) > 0.3 : ig > Igt && vak > 0.3;
      if (fires) this.on = true;
    } else if ((this.bidirectional ? Math.abs(iak) : iak) < Ih) {
      this.on = false;
    }
  }
  ac(s: AcStamper): void {
    const [A, K, G] = this.nodes;
    s.y(G, K, this.gateF.g());
    s.y(A, K, this.on ? this.mainF.g() : 1e-7);
  }
  limits(): Issue | null {
    return Math.abs(this.cur[0]) > 25 ? { level: 'burn', key: 'burn.thyristor', vars: { i: Math.abs(this.cur[0]) } } : null;
  }
  extra(): Record<string, number> {
    return { on: this.on ? 1 : 0 };
  }
  save(): unknown {
    return this.on;
  }
  load(s: unknown): void {
    if (typeof s === 'boolean') this.on = s;
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
  ac(s: AcStamper): void {
    if (this.broken) return;
    const [B, C, E] = this.nodes;
    const m = this.eval(this.vbe, this.vbc);
    const rows: [number, number[]][] = [
      [C, m.dIc],
      [B, m.dIb],
      [E, [-(m.dIc[0] + m.dIb[0]), -(m.dIc[1] + m.dIb[1])]],
    ];
    for (const [row, d] of rows) {
      s.trans(row, B, E, d[0]);
      s.trans(row, B, C, d[1]);
    }
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
  private oriented(): { d: number; s: number; vgs: number; vds: number } {
    const [, D, S] = this.nodes;
    const rev = this.vds < 0;
    return { d: rev ? S : D, s: rev ? D : S, vgs: rev ? this.vgs - this.vds : this.vgs, vds: Math.abs(this.vds) };
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
    this.vgs = stepLimit(rawGs, this.vgs, 1);
    this.vds = stepLimit(rawDs, this.vds, 2);
    this.limited = Math.abs(this.vgs - rawGs) + Math.abs(this.vds - rawDs) > 1e-9;
    // When vds < 0 the device is symmetric: swap drain and source.
    const o = this.oriented();
    const m = this.eval(o.vgs, o.vds);
    s.lin(
      [o.d, o.s],
      [p * m.id, -p * m.id],
      [
        [G, o.s, p * o.vgs],
        [o.d, o.s, p * o.vds],
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
  ac(s: AcStamper): void {
    if (this.broken) return;
    const G = this.nodes[0];
    const o = this.oriented();
    const m = this.eval(o.vgs, o.vds);
    s.trans(o.d, G, o.s, m.gm);
    s.trans(o.d, o.d, o.s, m.gds);
    s.trans(o.s, G, o.s, -m.gm);
    s.trans(o.s, o.d, o.s, -m.gds);
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

/**
 * Any digital part: inputs are high-impedance, outputs are 0 V or 5 V behind 100 Ω like TTL.
 * New outputs are computed after each step, a small realistic propagation delay.
 */
abstract class Digital extends Device {
  inLv: number[];
  out: number[];
  constructor(
    part: Part,
    nodes: number[],
    readonly ins: number[],
    readonly outs: number[],
  ) {
    super(part, nodes);
    this.inLv = ins.map(() => 0);
    this.out = outs.map(() => 0);
  }
  abstract logic(prev: number[]): void;
  stamp(s: Stamper): void {
    const g = 1 / LOGIC_ROUT;
    this.outs.forEach((pin, i) => {
      const o = this.nodes[pin];
      s.g(o, -1, g);
      s.flow(-1, o, this.out[i] * LOGIC_HIGH * g);
    });
    for (const pin of this.ins) s.g(this.nodes[pin], -1, 1e-6);
  }
  accept(c: Ctx): void {
    const cur = this.nodes.map(() => 0);
    const prev = [...this.inLv];
    this.ins.forEach((pin, i) => {
      const v = this.v(c.x, pin);
      this.inLv[i] = level(v, this.inLv[i]);
      cur[pin] = v * 1e-6;
    });
    this.outs.forEach((pin, i) => (cur[pin] = (this.v(c.x, pin) - this.out[i] * LOGIC_HIGH) / LOGIC_ROUT));
    this.cur = cur;
    this.logic(prev);
  }
  ac(s: AcStamper): void {
    for (const pin of this.outs) s.y(this.nodes[pin], -1, 1 / LOGIC_ROUT);
    for (const pin of this.ins) s.y(this.nodes[pin], -1, 1e-6);
  }
  rising(prev: number[], i: number): boolean {
    return prev[i] === 0 && this.inLv[i] === 1;
  }
  save(): unknown {
    return { inLv: this.inLv, out: this.out };
  }
  load(s: unknown): void {
    const o = s as { inLv: number[]; out: number[] } | null;
    if (o?.inLv?.length === this.inLv.length && o.out?.length === this.out.length) {
      this.inLv = [...o.inLv];
      this.out = [...o.out];
    }
  }
}

class Gate extends Digital {
  constructor(
    part: Part,
    nodes: number[],
    readonly fn: string,
  ) {
    super(
      part,
      nodes,
      Array.from({ length: nodes.length - 1 }, (_, i) => i),
      [nodes.length - 1],
    );
    this.out = [GATE_FN[fn](0, 0)];
  }
  logic(): void {
    this.out[0] = GATE_FN[this.fn](this.inLv[0], this.inLv[1] ?? 0);
  }
  extra(): Record<string, number> {
    return { out: this.out[0] };
  }
}

class DFlipFlop extends Digital {
  constructor(part: Part, nodes: number[]) {
    super(part, nodes, [0, 1], [2, 3]);
    this.out = [0, 1];
  }
  logic(prev: number[]): void {
    if (this.rising(prev, 1)) this.out = [this.inLv[0], 1 - this.inLv[0]];
  }
  extra(): Record<string, number> {
    return { q: this.out[0] };
  }
}

class JkFlipFlop extends Digital {
  constructor(part: Part, nodes: number[]) {
    super(part, nodes, [0, 1, 2], [3, 4]);
    this.out = [0, 1];
  }
  logic(prev: number[]): void {
    if (!this.rising(prev, 1)) return;
    const [j, , k] = this.inLv;
    let q = this.out[0];
    if (j && k) q = 1 - q;
    else if (j) q = 1;
    else if (k) q = 0;
    this.out = [q, 1 - q];
  }
  extra(): Record<string, number> {
    return { q: this.out[0] };
  }
}

class Counter extends Digital {
  count = 0;
  constructor(part: Part, nodes: number[]) {
    super(part, nodes, [0, 1], [2, 3, 4, 5]);
  }
  logic(prev: number[]): void {
    const mod = this.part.params.mod === '16' ? 16 : 10;
    if (this.inLv[1]) this.count = 0;
    else if (this.rising(prev, 0)) this.count = (this.count + 1) % mod;
    this.out = [0, 1, 2, 3].map((b) => (this.count >> b) & 1);
  }
  extra(): Record<string, number> {
    return { count: this.count };
  }
  save(): unknown {
    return { ...(super.save() as object), count: this.count };
  }
  load(s: unknown): void {
    super.load(s);
    const c = (s as { count?: number } | null)?.count;
    if (typeof c === 'number') this.count = c;
  }
}

/** Segments a..g for the digits 0–9 (bit 0 = a). */
const SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

class Bcd7 extends Digital {
  constructor(part: Part, nodes: number[]) {
    super(part, nodes, [0, 1, 2, 3], [4, 5, 6, 7, 8, 9, 10]);
    this.out = [1, 1, 1, 1, 1, 1, 0];
  }
  logic(): void {
    const n = this.inLv[0] + 2 * this.inLv[1] + 4 * this.inLv[2] + 8 * this.inLv[3];
    const bits = SEGMENTS[n] ?? 0;
    this.out = this.out.map((_, i) => (bits >> i) & 1);
  }
  extra(): Record<string, number> {
    return { value: this.inLv[0] + 2 * this.inLv[1] + 4 * this.inLv[2] + 8 * this.inLv[3] };
  }
}

class LogicIn extends Device {
  out = 0;
  stamp(s: Stamper): void {
    this.out = Number(this.part.params.state) === 1 ? 1 : 0;
    const g = 1 / LOGIC_ROUT;
    s.g(this.nodes[0], -1, g);
    s.flow(-1, this.nodes[0], this.out * LOGIC_HIGH * g);
  }
  accept(c: Ctx): void {
    this.cur = [(this.v(c.x, 0) - this.out * LOGIC_HIGH) / LOGIC_ROUT];
  }
  ac(s: AcStamper): void {
    s.y(this.nodes[0], -1, 1 / LOGIC_ROUT);
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
  ac(s: AcStamper): void {
    s.y(this.nodes[0], -1, 1e-6);
  }
  extra(): Record<string, number> {
    return { level: this.lvl };
  }
}

/** Behavioural NE555: two comparators, an SR flip-flop, a discharge switch and an output stage. */
class Timer555 extends Device {
  q = 0;
  // Pin order: VCC, RESET, DIS, THR, TRIG, GND, OUT, CTRL
  stamp(s: Stamper): void {
    const [VCC, RST, DIS, THR, TRIG, GND, OUT, CTRL] = this.nodes;
    s.g(VCC, CTRL, 1 / 5000);
    s.g(CTRL, GND, 1 / 10000);
    s.g(VCC, RST, 1 / 20000);
    s.g(THR, GND, 1e-7);
    s.g(TRIG, GND, 1e-7);
    const g = 1 / 10;
    if (this.q) {
      // Output sits about 1.5 V below VCC, as on the bipolar 555.
      s.g(OUT, VCC, g);
      s.flow(OUT, VCC, 1.5 * g);
      s.g(DIS, GND, 1e-9);
    } else {
      s.g(OUT, GND, g);
      s.g(DIS, GND, 1 / 20);
    }
  }
  accept(c: Ctx): void {
    const x = c.x;
    const vg = this.v(x, 5);
    const rel = (i: number) => this.v(x, i) - vg;
    const vcc = rel(0);
    const ctrl = rel(7);
    const iOut = this.q ? (this.v(x, 6) - this.v(x, 0) + 1.5) / 10 : (this.v(x, 6) - vg) / 10;
    const iDis = this.q ? 0 : rel(2) / 20;
    const iDiv = (vcc - ctrl) / 5000;
    const iRst = (vcc - rel(1)) / 20000;
    this.cur = [
      iDiv + iRst - (this.q ? iOut : 0),
      -iRst,
      iDis,
      rel(3) * 1e-7,
      rel(4) * 1e-7,
      0,
      iOut,
      -iDiv + ctrl / 10000,
    ];
    this.cur[5] = -this.cur.reduce((a, b) => a + b, 0);
    if (vcc < 3 || rel(1) < 0.7) this.q = 0;
    else if (rel(4) < ctrl / 2) this.q = 1;
    else if (rel(3) > ctrl) this.q = 0;
  }
  ac(s: AcStamper): void {
    const [VCC, RST, DIS, , , GND, OUT, CTRL] = this.nodes;
    s.y(VCC, CTRL, 1 / 5000);
    s.y(CTRL, GND, 1 / 10000);
    s.y(VCC, RST, 1 / 20000);
    s.y(OUT, this.q ? VCC : GND, 1 / 10);
    if (!this.q) s.y(DIS, GND, 1 / 20);
  }
  extra(): Record<string, number> {
    return { out: this.q };
  }
  save(): unknown {
    return this.q;
  }
  load(s: unknown): void {
    if (typeof s === 'number') this.q = s;
  }
}

/** Seven LEDs to a common cathode, each through a built-in resistor (internal nodes 8..14). */
class SevenSeg extends Device {
  readonly nonlinear = true;
  segs: Junction[];
  constructor(part: Part, nodes: number[]) {
    super(part, nodes);
    const m = ledModel(String(part.params.color));
    this.segs = Array.from({ length: 7 }, () => new Junction(m.Is, m.nvt));
  }
  rs(): number {
    return Math.max(this.num('Rs', 330), 1e-3);
  }
  stamp(s: Stamper, c: Ctx): void {
    if (this.broken) return;
    const m = ledModel(String(this.part.params.color));
    const com = this.nodes[7];
    let lim = false;
    this.segs.forEach((j, i) => {
      j.Is = m.Is;
      j.nvt = m.nvt;
      const inner = this.nodes[8 + i];
      lim = j.stamp(s, this.nodes[i], inner, this.v(c.x, i) - this.v(c.x, 8 + i)) || lim;
      s.g(inner, com, 1 / this.rs());
    });
    this.limited = lim;
  }
  accept(c: Ctx): void {
    const cur = this.nodes.map(() => 0);
    if (!this.broken) {
      let sum = 0;
      this.segs.forEach((j, i) => {
        const v = this.v(c.x, i) - this.v(c.x, 8 + i);
        j.vLast = v;
        const I = j.current(v);
        cur[i] = I;
        sum += I;
      });
      cur[7] = -sum;
    }
    this.cur = cur;
  }
  ac(s: AcStamper): void {
    this.segs.forEach((j, i) => {
      s.y(this.nodes[i], this.nodes[8 + i], j.g());
      s.y(this.nodes[8 + i], this.nodes[7], 1 / this.rs());
    });
  }
  limits(): Issue | null {
    const i = Math.max(...this.cur.slice(0, 7));
    return i > 0.06 ? { level: 'burn', key: 'burn.led', vars: { i, max: 0.02 } } : null;
  }
  extra(): Record<string, number> {
    const out: Record<string, number> = {};
    'abcdefg'.split('').forEach((ch, i) => (out[`seg_${ch}`] = Math.max(0, this.cur[i]) / 0.01));
    return out;
  }
}

// ---------------------------------------------------------------- meters

abstract class Meter extends Device {
  mean = 0;
  meanSq = 0;
  started = false;
  abstract sample(x: Float64Array): number;
  ac(s: AcStamper): void {
    s.y(this.nodes[0], this.nodes[1], 1e-7);
  }
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
  acMode(): boolean {
    return this.part.params.mode === 'ac';
  }
  reading(): number {
    return this.acMode() ? Math.sqrt(Math.max(0, this.meanSq - this.mean * this.mean)) : this.mean;
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
  ac(s: AcStamper): void {
    if (!this.broken) s.y(this.nodes[0], this.nodes[1], 100);
  }
  limits(): Issue | null {
    return Math.abs(this.cur[0]) > 10 ? { level: 'burn', key: 'burn.ammeter', vars: { i: Math.abs(this.cur[0]) } } : null;
  }
}

/**
 * The AVO meter. Volts: 10 MΩ. Amps: 0.01 Ω with a 10 A fuse.
 * Ohms and diode test: the meter pushes a small current from its own battery and reads V ÷ I,
 * which is why the circuit must be switched off first.
 */
class Multimeter extends Meter {
  private lastMode = '';
  private ohmV = 0;
  private ohmI = 0;
  mode(): string {
    return String(this.part.params.mode);
  }
  source(): { vt: number; rs: number } | null {
    const m = this.mode();
    if (m === 'ohm') return { vt: 1, rs: 1000 };
    if (m === 'diode') return { vt: 3, rs: 3000 };
    return null;
  }
  isAmps(): boolean {
    return this.mode() === 'adc' || this.mode() === 'aac';
  }
  acMode(): boolean {
    return this.mode() === 'vac' || this.mode() === 'aac';
  }
  stamp(s: Stamper): void {
    const [p, n] = this.nodes;
    const src = this.source();
    if (src) {
      s.g(p, n, 1 / src.rs);
      s.flow(n, p, src.vt / src.rs);
    } else if (this.isAmps()) {
      if (!this.broken) s.g(p, n, 100);
    } else s.g(p, n, 1e-7);
  }
  sample(x: Float64Array): number {
    return this.isAmps() ? this.cur[0] : this.v(x, 0) - this.v(x, 1);
  }
  accept(c: Ctx): void {
    if (this.mode() !== this.lastMode) {
      this.lastMode = this.mode();
      this.started = false;
    }
    const v = this.v(c.x, 0) - this.v(c.x, 1);
    const src = this.source();
    let i: number;
    if (src) {
      i = (v - src.vt) / src.rs;
      this.ohmV = v;
      this.ohmI = -i;
    } else if (this.isAmps()) i = this.broken ? 0 : v * 100;
    else i = v * 1e-7;
    this.cur = [i, -i];
    if (!src) this.track(c);
  }
  ac(s: AcStamper): void {
    const src = this.source();
    s.y(this.nodes[0], this.nodes[1], src ? 1 / src.rs : this.isAmps() ? 100 : 1e-7);
  }
  /** Reading in the unit of the current mode; Infinity means "OL" (over limit). */
  reading(): number {
    const m = this.mode();
    if (m === 'ohm') {
      if (this.ohmI <= 1e-11) return Infinity;
      const r = this.ohmV / this.ohmI;
      return r > 40e6 || r < 0 ? Infinity : r;
    }
    if (m === 'diode') return this.ohmV > 2.5 ? Infinity : this.ohmV;
    return super.reading();
  }
  limits(): Issue | null {
    return this.isAmps() && Math.abs(this.cur[0]) > 10 ? { level: 'burn', key: 'burn.ammeter', vars: { i: Math.abs(this.cur[0]) } } : null;
  }
  advice(): Issue | null {
    const src = this.source();
    // On a passive part the meter's own voltage can only fall between 0 and its test voltage.
    if (src && (this.ohmV > src.vt + 0.01 || this.ohmV < -0.01 || this.ohmI < -1e-9)) return { level: 'warn', key: 'warn.ohmPowered' };
    return null;
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
    case 'ldr':
      return new Ldr(part, nodes);
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
    case 'psu':
      return new PowerSupply(part, nodes);
    case 'capacitor':
      return new Capacitor(part, nodes, false);
    case 'ecap':
      return new Capacitor(part, nodes, true);
    case 'inductor':
      return new Inductor(part, nodes);
    case 'transformer':
      return new Transformer(part, nodes);
    case 'diode':
    case 'schottky':
    case 'zener':
    case 'led':
    case 'photodiode':
      return new Diode(part, nodes, part.type);
    case 'scr':
      return new Thyristor(part, nodes, false);
    case 'triac':
      return new Thyristor(part, nodes, true);
    case 'npn':
      return new Bjt(part, nodes, 1);
    case 'pnp':
      return new Bjt(part, nodes, -1);
    case 'nmos':
      return new Mosfet(part, nodes, 1);
    case 'pmos':
      return new Mosfet(part, nodes, -1);
    case 'dff':
      return new DFlipFlop(part, nodes);
    case 'jkff':
      return new JkFlipFlop(part, nodes);
    case 'counter':
      return new Counter(part, nodes);
    case 'bcd7':
      return new Bcd7(part, nodes);
    case 'timer555':
      return new Timer555(part, nodes);
    case 'sevenseg':
      return new SevenSeg(part, nodes);
    case 'logicin':
      return new LogicIn(part, nodes);
    case 'logicout':
      return new LogicOut(part, nodes);
    case 'voltmeter':
      return new Voltmeter(part, nodes);
    case 'ammeter':
      return new Ammeter(part, nodes);
    case 'multimeter':
      return new Multimeter(part, nodes);
    case 'probe':
      return new Probe(part, nodes);
    default:
      if (part.type in GATE_FN) return new Gate(part, nodes, part.type);
      return new Nothing(part, nodes);
  }
}
