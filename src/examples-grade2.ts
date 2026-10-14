/**
 * Ready-made circuits for the grade-2 practical training book (communications), one per exercise.
 * `ref` is the exercise number in the book. Values follow the book where the simulator allows;
 * radio-frequency circuits are scaled down to audio frequencies (noted in their titles), because
 * the board animates in real time.
 */
import { Builder } from './model/docops';
import type { Pt } from './model/types';
import type { Example } from './examples';

const P = (x: number, y: number): Pt => ({ x, y });

/** Supply rails used by the transistor circuits. */
const VCC_Y = -200;
const GND_Y = 200;

interface Stage {
  in: Pt;
  out: Pt;
}

/**
 * Common-emitter stage with voltage-divider bias. Its left edge is the base divider at x = ox.
 * Re is split: a small unbypassed part (sets the gain) and a bypassed part (sets the bias).
 */
function ceStage(b: Builder, ox: number, v: { rb1: number; rb2: number; rc: number; re1: number; re2: number }, inputCap = true): Stage {
  b.add('resistor', ox, -120, 1, { R: v.rb1 });
  b.add('resistor', ox, 60, 1, { R: v.rb2 });
  b.add('npn', ox + 60, 0, 0, { beta: 150 });
  b.add('resistor', ox + 80, -120, 1, { R: v.rc });
  b.add('resistor', ox + 80, 80, 1, { R: v.re1 });
  b.add('resistor', ox + 80, 160, 1, { R: v.re2 });
  b.add('ecap', ox + 140, 160, 1, { C: 100e-6 });
  if (inputCap) b.add('ecap', ox - 60, 0, 2, { C: 1e-6 });
  // A plain (non-polarised) output capacitor: the next stage may sit at a higher DC level.
  b.add('capacitor', ox + 140, -40, 0, { C: 1e-6 });
  b.path(P(ox, -160), P(ox, VCC_Y));
  b.path(P(ox, 100), P(ox, GND_Y));
  b.path(P(ox, -80), P(ox, 20));
  b.path(P(ox, 0), P(ox + 20, 0));
  if (inputCap) b.path(P(ox - 20, 0), P(ox, 0));
  b.path(P(ox + 80, -160), P(ox + 80, VCC_Y));
  b.path(P(ox + 80, -80), P(ox + 80, -40), P(ox + 100, -40));
  b.path(P(ox + 80, 120), P(ox + 140, 120));
  return { in: inputCap ? P(ox - 100, 0) : P(ox, 0), out: P(ox + 180, -40) };
}

/** Signal generator on the left with its own ground and a channel-1 probe on its output. */
function source(b: Builder, to: Pt, params: Record<string, string | number>): void {
  b.add('funcgen', -200, to.y + 40, 0, { r: 50, ...params });
  b.add('ground', -200, to.y + 80);
  b.add('probe', -200, to.y, 0, { ch: '1' });
  b.path(P(-200, to.y), to);
}

/** Battery at x = bx between the rails. */
function supply(b: Builder, bx: number, volts: number, left = 0): void {
  b.add('battery', bx, -120, 0, { V: volts });
  b.add('ground', bx, GND_Y);
  b.path(P(bx, -160), P(bx, VCC_Y), P(left, VCC_Y));
  b.path(P(bx, -80), P(bx, GND_Y), P(left, GND_Y));
}

/** Load resistor from `out` to the ground rail, with a channel-2 probe. */
function load(b: Builder, out: Pt, x: number, params: Record<string, number>, type = 'resistor'): void {
  b.add(type, x, out.y + 40, 1, params);
  b.add('probe', x, out.y, 0, { ch: '2' });
  b.path(out, P(x, out.y));
  b.path(P(x, out.y + 80), P(x, GND_Y));
}

/**
 * Complementary output stage (NPN on top, PNP flipped below), biased by two diodes.
 * Input at its left (ox − 100, 0), output on its right.
 */
function complementary(b: Builder, ox: number, inputCap = true): Stage {
  b.add('resistor', ox, -120, 1, { R: 4700 });
  b.add('diode', ox, -40, 1);
  b.add('diode', ox, 40, 1);
  b.add('resistor', ox, 120, 1, { R: 4700 });
  b.add('npn', ox + 100, -80, 0, { beta: 100, Pmax: 10 });
  b.flip(b.add('pnp', ox + 100, 160, 0, { beta: 100, Pmax: 10 }));
  b.add('resistor', ox + 120, 0, 1, { R: 1, Pmax: 1 });
  b.add('resistor', ox + 120, 80, 1, { R: 1, Pmax: 1 });
  if (inputCap) b.add('ecap', ox - 60, 0, 2, { C: 10e-6 });
  b.add('ecap', ox + 240, 40, 0, { C: 220e-6 });
  b.path(P(ox, -160), P(ox, VCC_Y));
  b.path(P(ox, 160), P(ox, GND_Y));
  b.path(P(ox, -80), P(ox + 60, -80));
  b.path(P(ox, 80), P(ox + 40, 80), P(ox + 40, 160), P(ox + 60, 160));
  b.path(P(ox + 120, -120), P(ox + 120, VCC_Y));
  if (inputCap) b.path(P(ox - 20, 0), P(ox, 0));
  b.path(P(ox + 120, 40), P(ox + 200, 40));
  return { in: inputCap ? P(ox - 100, 0) : P(ox, 0), out: P(ox + 280, 40) };
}

const CE_8V = { rb1: 47000, rb2: 10000, rc: 4700, re1: 220, re2: 1000 };

export const GRADE2: Example[] = [
  {
    id: 'g2-ce',
    grade: 2,
    ar: 'مكبر الباعث المشترك',
    en: 'Common-emitter amplifier',
    ref: '1',
    scopeWindow: 0.005,
    build() {
      const b = new Builder('مكبر الباعث المشترك');
      const s = ceStage(b, 0, CE_8V);
      source(b, s.in, { wave: 'sine', Vp: 0.002, f: 1000 });
      load(b, s.out, 220, { R: 10000 });
      supply(b, 300, 8);
      return b.done();
    },
  },
  {
    id: 'g2-two-stage',
    grade: 2,
    ar: 'مكبر الإشارة الصغيرة من مرحلتين (ربط RC)',
    en: 'Two-stage RC-coupled amplifier',
    ref: '2',
    scopeWindow: 0.0005,
    build() {
      const b = new Builder('مكبر من مرحلتين');
      const a = ceStage(b, 0, CE_8V);
      const c = ceStage(b, 320, CE_8V, false);
      b.path(a.out, P(200, -40), P(200, 0), c.in);
      source(b, a.in, { wave: 'sine', Vp: 0.005, f: 10000 });
      load(b, c.out, 540, { R: 10000 });
      supply(b, 620, 12);
      return b.done();
    },
  },
  {
    id: 'g2-complementary',
    grade: 2,
    ar: 'مكبر القدرة المتمم (NPN و PNP)',
    en: 'Complementary power amplifier',
    ref: '4',
    scopeWindow: 0.005,
    build() {
      const b = new Builder('مكبر القدرة المتمم');
      const s = complementary(b, 0);
      source(b, s.in, { wave: 'sine', Vp: 2, f: 1000 });
      load(b, s.out, 280, { R: 10, Pmax: 5 });
      supply(b, 380, 12);
      return b.done();
    },
  },
  {
    id: 'g2-audio-amp',
    grade: 2,
    ar: 'مكبر سمعي ومكبر قدرة مع سماعة',
    en: 'Audio pre-amplifier and power amplifier with a speaker',
    ref: '5',
    scopeWindow: 0.005,
    build() {
      const b = new Builder('مكبر سمعي ومكبر قدرة');
      const pre = ceStage(b, 0, CE_8V);
      const out = complementary(b, 340, false);
      b.path(pre.out, P(220, -40), P(220, 0), out.in);
      source(b, pre.in, { wave: 'sine', Vp: 0.1, f: 1000 });
      load(b, out.out, 620, { R: 8, Pmax: 5 }, 'speaker');
      supply(b, 720, 12);
      return b.done();
    },
  },
  {
    id: 'g2-tuned-amp',
    grade: 2,
    ar: 'مكبر الحزمة الضيقة (دائرة رنين في الجامع، مصغّر إلى 16 كيلوهرتز)',
    en: 'Narrow-band (tuned) amplifier, scaled to 16 kHz',
    ref: '6',
    scopeWindow: 0.0005,
    build() {
      const b = new Builder('مكبر الحزمة الضيقة');
      // The collector load is a parallel LC tank: the gain peaks at f0 = 1 / (2π√LC) ≈ 15.9 kHz.
      b.add('resistor', 0, -120, 1, { R: 47000 });
      b.add('resistor', 0, 60, 1, { R: 10000 });
      b.add('npn', 60, 0, 0, { beta: 150 });
      b.add('inductor', 80, -120, 1, { L: 0.01, Rs: 5 });
      b.add('capacitor', 140, -120, 1, { C: 10e-9 });
      b.add('resistor', 80, 80, 1, { R: 220 });
      b.add('resistor', 80, 160, 1, { R: 1000 });
      b.add('ecap', 140, 160, 1, { C: 100e-6 });
      b.add('ecap', -60, 0, 2, { C: 10e-6 });
      b.add('capacitor', 220, -40, 0, { C: 100e-9 });
      b.path(P(0, -160), P(0, VCC_Y));
      b.path(P(0, 100), P(0, GND_Y));
      b.path(P(0, -80), P(0, 20));
      b.path(P(0, 0), P(20, 0));
      b.path(P(-20, 0), P(0, 0));
      b.path(P(80, -160), P(80, VCC_Y));
      b.path(P(140, -160), P(140, VCC_Y));
      b.path(P(80, -80), P(140, -80));
      b.path(P(80, -80), P(80, -40), P(180, -40));
      b.path(P(80, 120), P(140, 120));
      source(b, P(-100, 0), { wave: 'sine', Vp: 0.01, f: 15900 });
      load(b, P(260, -40), 300, { R: 10000 });
      supply(b, 380, 12);
      // Bode plotter: input at the generator, output at the load.
      b.add('bode', -100, -300, 0, { fmin: 1000, fmax: 100000 });
      b.path(P(-120, -260), P(-200, -260), P(-200, 0));
      b.path(P(-80, -260), P(300, -260), P(300, -40));
      return b.done();
    },
  },
  {
    id: 'g2-phase-shift-tr',
    grade: 2,
    ar: 'مذبذب إزاحة الطور RC بالترانزستور',
    en: 'RC phase-shift oscillator with a transistor',
    ref: '7',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('مذبذب إزاحة الطور');
      // Three RC sections (each about 60°) feed the collector back to the base: f ≈ 1 / (2πRC√6).
      b.add('resistor', 0, -120, 1, { R: 47000 });
      b.add('resistor', 0, 60, 1, { R: 10000 });
      b.add('npn', 60, 0, 0, { beta: 200 });
      b.add('resistor', 80, -120, 1, { R: 4700 });
      b.add('resistor', 80, 120, 1, { R: 1000 });
      b.add('ecap', 140, 120, 1, { C: 100e-6 });
      b.add('capacitor', 140, -80, 0, { C: 10e-9 });
      b.add('resistor', 180, 0, 1, { R: 10000 });
      b.add('capacitor', 240, -80, 0, { C: 10e-9 });
      b.add('resistor', 280, 0, 1, { R: 10000 });
      b.add('capacitor', 340, -80, 0, { C: 10e-9 });
      b.add('probe', 80, -40, 0, { ch: '1' });
      b.add('probe', 380, -80, 0, { ch: '2' });
      b.path(P(0, -160), P(0, VCC_Y));
      b.path(P(0, 100), P(0, GND_Y));
      b.path(P(0, -80), P(0, 20));
      b.path(P(0, 0), P(20, 0));
      b.path(P(80, -160), P(80, VCC_Y));
      b.path(P(80, -80), P(80, -40));
      b.path(P(80, -40), P(100, -40), P(100, -80));
      b.path(P(80, 80), P(80, 40));
      b.path(P(80, 160), P(80, GND_Y));
      b.path(P(80, 40), P(140, 40), P(140, 80));
      b.path(P(140, 160), P(140, GND_Y));
      b.path(P(180, -80), P(200, -80));
      b.path(P(180, -80), P(180, -40));
      b.path(P(180, 40), P(180, GND_Y));
      b.path(P(280, -80), P(300, -80));
      b.path(P(280, -80), P(280, -40));
      b.path(P(280, 40), P(280, GND_Y));
      // The last section returns to the base through the bias divider.
      b.path(P(380, -80), P(420, -80), P(420, -240), P(-60, -240), P(-60, 0), P(0, 0));
      supply(b, 480, 12);
      return b.done();
    },
  },
  oscillator('g2-tuned-osc', 'مذبذب الجامع المنغم (مصغّر إلى 1 كيلوهرتز)', 'Tuned-collector oscillator, scaled to 1 kHz', '8', 'tuned'),
  oscillator('g2-hartley', 'مذبذب هارتلي (مصغّر إلى 1 كيلوهرتز)', 'Hartley oscillator, scaled to 1 kHz', '9', 'hartley'),
  oscillator('g2-colpitts', 'مذبذب كولبتس (مصغّر إلى 1 كيلوهرتز)', 'Colpitts oscillator, scaled to 1 kHz', '10', 'colpitts'),
  rcShaper('g2-rc-diff', 'دائرة التفاضل RC (موجة مربعة إلى نبضات حادة)', 'RC differentiator', '11', 'capacitor', 'resistor'),
  rcShaper('g2-rc-int', 'دائرة التكامل RC (موجة مربعة إلى مثلثية)', 'RC integrator', '12', 'resistor', 'capacitor'),
  {
    id: 'g2-gates',
    grade: 2,
    ar: 'البوابات المنطقية NAND و NOR و NOT و XNOR',
    en: 'Logic gates NAND, NOR, NOT and XNOR',
    ref: '13',
    build() {
      const b = new Builder('البوابات المنطقية');
      // Gate centres at y = 0, 120, 240: input A at y − 20 (bus x = 140), B at y + 20 (bus x = 160).
      b.add('logicin', 0, -20);
      b.add('logicin', 0, 300);
      ['nand', 'nor', 'xnor'].forEach((g, i) => {
        const y = i * 120;
        b.add(g, 240, y);
        b.add('logicout', 380, y);
        b.path(P(280, y), P(340, y));
        b.path(P(140, y - 20), P(200, y - 20));
        b.path(P(160, y + 20), P(200, y + 20));
      });
      b.path(P(40, -20), P(140, -20), P(140, 360), P(200, 360));
      b.path(P(40, 300), P(160, 300), P(160, 20));
      b.add('not', 240, 360);
      b.add('logicout', 380, 360);
      b.path(P(280, 360), P(340, 360));
      return b.done();
    },
  },
  {
    id: 'g2-astable',
    grade: 2,
    ar: 'المذبذب متعدد الاهتزاز غير المستقر بترانزستورين',
    en: 'Astable multivibrator with two transistors',
    ref: '14',
    scopeWindow: 0.5,
    build() {
      const b = new Builder('متعدد الاهتزاز غير المستقر');
      // Each half-period ≈ 0.69 · R · C = 0.69 · 10 kΩ · 10 µF ≈ 69 ms: the LEDs blink in turn.
      b.add('npn', 60, 100, 0, { beta: 150 });
      b.add('npn', 340, 100, 0, { beta: 150 });
      b.add('resistor', 80, -120, 1, { R: 470 });
      b.add('led', 80, -20, 1, { color: 'red' });
      b.add('resistor', 360, -120, 1, { R: 470 });
      b.add('led', 360, -20, 1, { color: 'green' });
      b.add('resistor', 140, -120, 1, { R: 10000 });
      b.add('resistor', 260, -120, 1, { R: 10000 });
      b.add('ecap', 200, 20, 0, { C: 10e-6 });
      b.add('ecap', 240, 60, 2, { C: 10e-6 });
      b.add('probe', 360, 40, 0, { ch: '1' });
      b.add('probe', 80, 40, 0, { ch: '2' });
      for (const x of [80, 140, 260, 360]) b.path(P(x, -160), P(x, VCC_Y));
      b.path(P(80, -80), P(80, -60));
      b.path(P(360, -80), P(360, -60));
      b.path(P(80, 20), P(80, 60));
      b.path(P(360, 20), P(360, 60));
      b.path(P(80, 140), P(80, GND_Y));
      b.path(P(360, 140), P(360, GND_Y));
      // C1: Q1 collector → Q2 base (pulled up by 10 kΩ). C2: Q2 collector → Q1 base.
      b.path(P(80, 40), P(120, 40), P(120, 20), P(160, 20));
      b.path(P(240, 20), P(260, 20), P(260, 100), P(300, 100));
      b.path(P(260, -80), P(260, 20));
      b.path(P(360, 40), P(320, 40), P(320, 60), P(280, 60));
      b.path(P(200, 60), P(140, 60), P(140, 100), P(20, 100));
      b.path(P(140, -80), P(140, 60));
      supply(b, 480, 5, 80);
      return b.done();
    },
  },
  {
    id: 'g2-monostable',
    grade: 2,
    ar: 'المذبذب أحادي الاستقرار بترانزستورين',
    en: 'Monostable multivibrator with two transistors',
    ref: '15',
    scopeWindow: 0.5,
    build() {
      const b = new Builder('أحادي الاستقرار');
      // Q2 is held on through R; a short press on the button switches Q1 on, the capacitor
      // turns Q2 off for about 0.69 · R · C ≈ 100 ms, then the circuit returns by itself.
      b.add('npn', 60, 100, 0, { beta: 150 });
      b.add('npn', 340, 100, 0, { beta: 150 });
      b.add('resistor', 80, -120, 1, { R: 1000 });
      b.add('led', 80, -20, 1, { color: 'red' });
      b.add('resistor', 360, -120, 1, { R: 1000 });
      b.add('led', 360, -20, 1, { color: 'green' });
      b.add('ecap', 200, 20, 0, { C: 10e-6 });
      b.add('resistor', 260, -80, 1, { R: 15000 });
      b.add('resistor', 200, 160, 0, { R: 10000 });
      b.add('resistor', -20, 160, 1, { R: 10000 });
      b.add('button', -60, 40, 1);
      b.add('resistor', -60, -80, 1, { R: 10000 });
      b.add('probe', 360, 60, 0, { ch: '1' });
      b.add('probe', 80, 60, 0, { ch: '2' });
      b.path(P(80, -160), P(80, VCC_Y));
      b.path(P(360, -160), P(360, VCC_Y));
      b.path(P(260, -120), P(260, VCC_Y));
      b.path(P(-60, -120), P(-60, VCC_Y));
      b.path(P(80, -80), P(80, -60));
      b.path(P(360, -80), P(360, -60));
      b.path(P(80, 20), P(80, 60));
      b.path(P(360, 20), P(360, 60));
      b.path(P(80, 140), P(80, GND_Y));
      b.path(P(360, 140), P(360, GND_Y));
      // Q1 collector → C → Q2 base (held up by R); Q2 collector → 10 kΩ → Q1 base.
      b.path(P(80, 60), P(80, 20), P(160, 20));
      b.path(P(240, 20), P(260, 20), P(260, 100), P(300, 100));
      b.path(P(260, -40), P(260, 20));
      b.path(P(360, 60), P(400, 60), P(400, 160), P(240, 160));
      b.path(P(160, 160), P(20, 160), P(20, 100));
      b.path(P(20, 100), P(-20, 100), P(-20, 120));
      b.path(P(-20, 200), P(-20, GND_Y));
      // The trigger button pulls Q1's base up from +V through 10 kΩ.
      b.path(P(-60, -40), P(-60, 0));
      b.path(P(-60, 80), P(-60, 100), P(-20, 100));
      supply(b, 480, 6, -60);
      return b.done();
    },
  },
  {
    id: 'g2-bistable-555',
    grade: 2,
    ar: 'المذبذب ثنائي الاستقرار بالمؤقت 555',
    en: 'Bistable multivibrator with a 555',
    ref: '16',
    build() {
      const b = new Builder('ثنائي الاستقرار 555');
      // TRIG (2) low sets the output high; RESET (4) low clears it. THR (6) is grounded.
      b.add('timer555', 200, 0);
      b.add('resistor', 60, -120, 1, { R: 10000 });
      b.add('button', 60, 80, 1);
      b.add('resistor', 340, -160, 1, { R: 10000 });
      b.add('button', 340, -60, 1);
      b.add('resistor', 360, 40, 0, { R: 330 });
      b.add('led', 440, 80, 1, { color: 'red' });
      b.add('probe', 260, -20, 0, { ch: '1' });
      b.path(P(180, -80), P(180, VCC_Y));
      b.path(P(60, -160), P(60, VCC_Y));
      b.path(P(340, -200), P(340, VCC_Y));
      b.path(P(200, 80), P(200, GND_Y));
      b.path(P(60, -80), P(60, 40));
      b.path(P(60, 40), P(140, 40));
      b.path(P(60, 120), P(60, GND_Y));
      b.path(P(140, 0), P(120, 0), P(120, GND_Y));
      b.path(P(140, -40), P(120, -40), P(120, 0));
      b.path(P(220, -80), P(220, -100), P(340, -100));
      b.path(P(340, -120), P(340, -100));
      b.path(P(340, -20), P(340, GND_Y));
      b.path(P(260, 0), P(260, -20));
      b.path(P(260, 0), P(300, 0), P(300, 40), P(320, 40));
      b.path(P(400, 40), P(440, 40));
      b.path(P(440, 120), P(440, GND_Y));
      supply(b, 520, 9, 60);
      return b.done();
    },
  },
  {
    id: 'g2-rs-latch',
    grade: 2,
    ar: 'النطاط RS باستخدام بوابات NAND',
    en: 'RS latch with NAND gates',
    ref: '17',
    build() {
      const b = new Builder('النطاط RS');
      // Active-low inputs: S = 0 sets Q to 1, R = 0 resets it. S = R = 1 keeps the last state.
      b.add('logicin', 0, -20, 0, { state: 1 });
      b.add('logicin', 0, 220, 0, { state: 1 });
      b.add('nand', 200, 0);
      b.add('nand', 200, 200);
      b.add('logicout', 400, 0);
      b.add('logicout', 400, 200);
      b.path(P(40, -20), P(160, -20));
      b.path(P(40, 220), P(160, 220));
      b.path(P(240, 0), P(360, 0));
      b.path(P(240, 200), P(360, 200));
      // Cross-coupling: each output goes back to the other gate.
      b.path(P(300, 0), P(300, 100), P(120, 100), P(120, 180), P(160, 180));
      b.path(P(300, 200), P(300, 140), P(100, 140), P(100, 20), P(160, 20));
      return b.done();
    },
  },
  {
    id: 'g2-am-mod',
    grade: 2,
    ar: 'التضمين السعوي AM بالثنائي ودائرة الرنين (مصغّر)',
    en: 'AM modulator: diode and tuned circuit (scaled down)',
    ref: '18',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('التضمين السعوي');
      // Carrier (10 kHz) and audio (500 Hz) in series drive a diode; the tank tuned to the carrier
      // keeps the carrier and its two side bands: an AM wave.
      b.add('funcgen', 0, 40, 0, { wave: 'sine', Vp: 2, f: 10000, r: 50 });
      b.add('funcgen', 0, 160, 0, { wave: 'sine', Vp: 1, f: 500, r: 50 });
      b.add('ground', 0, 200);
      b.add('diode', 100, 0);
      b.add('inductor', 200, 80, 1, { L: 0.01, Rs: 2 });
      b.add('capacitor', 280, 80, 1, { C: 25.3e-9 });
      b.add('resistor', 360, 80, 1, { R: 4700 });
      b.add('probe', 360, 0, 0, { ch: '1' });
      b.path(P(0, 0), P(60, 0));
      b.path(P(0, 80), P(0, 120));
      b.path(P(140, 0), P(360, 0), P(360, 40));
      b.path(P(200, 0), P(200, 40));
      b.path(P(280, 0), P(280, 40));
      b.path(P(200, 120), P(200, 200), P(0, 200));
      b.path(P(280, 120), P(280, 200), P(200, 200));
      b.path(P(360, 120), P(360, 200), P(280, 200));
      return b.done();
    },
  },
  {
    id: 'g2-fm',
    grade: 2,
    ar: 'التضمين الترددي FM',
    en: 'Frequency modulation (FM)',
    ref: '19',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('التضمين الترددي');
      b.add('funcgen', 0, 40, 0, { wave: 'fm', Vp: 2, f: 5000, fm: 200, dev: 2500, r: 50 });
      b.add('ground', 0, 80);
      b.add('resistor', 120, 40, 1, { R: 1000 });
      b.add('probe', 0, 0, 0, { ch: '1' });
      b.path(P(0, 0), P(120, 0));
      b.path(P(120, 80), P(0, 80));
      return b.done();
    },
  },
  {
    id: 'g2-fm-det',
    grade: 2,
    ar: 'الكشف الترددي FM بدائرة رنين مائلة (كاشف الميل)',
    en: 'FM slope detector',
    ref: '21',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('الكاشف الترددي');
      // The tank is tuned above the carrier, so its output rises and falls with the frequency:
      // FM becomes AM, and a diode envelope detector recovers the audio.
      b.add('funcgen', 0, 40, 0, { wave: 'fm', Vp: 2, f: 10000, fm: 200, dev: 2000, r: 50 });
      b.add('ground', 0, 80);
      b.add('resistor', 100, 0, 0, { R: 2200 });
      b.add('inductor', 200, 40, 1, { L: 0.01, Rs: 2 });
      b.add('capacitor', 260, 40, 1, { C: 18e-9 });
      b.add('schottky', 340, 0);
      b.add('capacitor', 420, 40, 1, { C: 47e-9 });
      b.add('resistor', 480, 40, 1, { R: 22000 });
      b.add('probe', 0, 0, 0, { ch: '1' });
      b.add('probe', 480, 0, 0, { ch: '2' });
      b.path(P(0, 0), P(60, 0));
      b.path(P(140, 0), P(300, 0));
      b.path(P(380, 0), P(480, 0));
      b.path(P(200, 80), P(200, 120));
      b.path(P(0, 80), P(0, 120), P(480, 120), P(480, 80));
      b.path(P(260, 80), P(260, 120));
      b.path(P(420, 80), P(420, 120));
      return b.done();
    },
  },
  {
    id: 'g2-crystal-radio',
    grade: 2,
    ar: 'راديو بسيط (دائرة رنين وكاشف وسماعة، مصغّر)',
    en: 'Simple (crystal) radio, scaled down',
    ref: '22',
    scopeWindow: 0.02,
    build() {
      const b = new Builder('راديو بسيط');
      // Two "stations" at 8 kHz and 14 kHz reach the aerial. Turn the tuning capacitor to pick one:
      // 40 nF tunes to 8 kHz, 13 nF to 14 kHz.
      b.add('funcgen', 0, 40, 0, { wave: 'am', Vp: 1, f: 8000, fm: 300, m: 0.8, r: 1000 });
      b.add('funcgen', 0, 160, 0, { wave: 'am', Vp: 1, f: 14000, fm: 600, m: 0.8, r: 1000 });
      b.add('ground', 0, 200);
      b.add('inductor', 160, 80, 1, { L: 0.01, Rs: 2 });
      b.add('capacitor', 240, 80, 1, { C: 40e-9 });
      b.add('diode', 320, 0);
      b.add('capacitor', 400, 80, 1, { C: 47e-9 });
      b.add('resistor', 460, 80, 1, { R: 22000 });
      b.add('speaker', 540, 80, 1, { R: 1000, Pmax: 0.1 });
      b.add('probe', 160, 0, 0, { ch: '1' });
      b.add('probe', 460, 0, 0, { ch: '2' });
      b.path(P(0, 0), P(280, 0));
      b.path(P(0, 80), P(0, 120));
      b.path(P(160, 0), P(160, 40));
      b.path(P(240, 0), P(240, 40));
      b.path(P(360, 0), P(540, 0), P(540, 40));
      b.path(P(400, 0), P(400, 40));
      b.path(P(460, 0), P(460, 40));
      b.path(P(0, 200), P(540, 200));
      for (const x of [160, 240, 400, 460, 540]) b.path(P(x, 120), P(x, 200));
      return b.done();
    },
  },
  tlineExample('g2-tl-matched', 'خط النقل: حمل مساوٍ لممانعة الخط (لا انعكاس)', 'Transmission line with a matched load', '26', 75),
  tlineExample('g2-tl-short', 'خط النقل: نهاية مقصورة (انعكاس معكوس)', 'Transmission line with a shorted end', '27', 'short'),
  tlineExample('g2-tl-open', 'خط النقل: نهاية مفتوحة (انعكاس كلي)', 'Transmission line with an open end', '28', 'open'),
  tlineExample('g2-tl-sent', 'الإشارة المرسلة والمستلمة (موجة جيبية)', 'Sent and received sine wave', '29', 75, true),
  tlineExample('g2-tl-mismatch', 'فرق الطور والموجات الواقفة (حمل 300 أوم)', 'Phase difference and standing waves (300 Ω load)', '30', 300, true),
  tlineExample('g2-tl-loss', 'الاضمحلال في خط النقل (6 ديسيبل)', 'Attenuation along the line (6 dB)', '31', 75, true, 6),
  {
    id: 'g2-7seg-switches',
    grade: 2,
    ar: 'عارضة القطع السبع بالمفاتيح',
    en: 'Seven-segment display driven by switches',
    ref: '32',
    build() {
      const b = new Builder('عارضة القطع السبع');
      // Each switch lights one segment through 150 Ω, like the book's figure 6-3.
      b.add('battery', -200, 0, 0, { V: 5 });
      b.add('ground', -200, 40);
      b.add('sevenseg', 480, 0);
      b.add('ground', 480, 140);
      b.path(P(480, 100), P(480, 140));
      b.path(P(-200, -40), P(-200, -280), P(-80, -280), P(-80, 240));
      for (let i = 0; i < 7; i++) {
        const sy = -240 + i * 80;
        const x = 200 + i * 20;
        const seg = -60 + i * 20;
        b.add('switch', -40, sy, 0, { closed: i === 6 ? 0 : 1 });
        b.add('resistor', 100, sy, 0, { R: 150 });
        b.path(P(0, sy), P(60, sy));
        b.path(P(140, sy), P(x, sy), P(x, seg), P(440, seg));
      }
      return b.done();
    },
  },
  {
    id: 'g2-diac',
    grade: 2,
    ar: 'الدايك يقدح الترياك (منظم إضاءة)',
    en: 'DIAC firing a triac (lamp dimmer)',
    ref: '36',
    scopeWindow: 0.05,
    build() {
      const b = new Builder('الدايك والترياك');
      // The pot and capacitor delay the voltage; when it reaches about 32 V the DIAC fires the triac.
      b.add('ac', 0, 0, 0, { Vp: 311, f: 50, r: 0.5 });
      b.add('ground', 0, 40);
      b.add('lamp', 160, -80, 0, { V: 220, P: 60 });
      b.add('triac', 400, 0, 1);
      b.add('resistor', 240, -20, 1, { R: 3300 });
      b.add('pot', 240, 60, 1, { R: 250000, pos: 0.3 });
      b.add('capacitor', 240, 180, 1, { C: 100e-9 });
      b.add('diac', 300, 140, 0);
      b.add('resistor', 360, 80, 1, { R: 100 });
      b.add('probe', 400, -80, 0, { ch: '1' });
      b.add('probe', 200, 100, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -80), P(120, -80));
      b.path(P(200, -80), P(400, -80), P(400, -40));
      b.path(P(240, -80), P(240, -60));
      // The pot is used as a variable resistor: wiper joined to one end.
      b.path(P(280, 60), P(280, 100), P(240, 100));
      b.path(P(200, 100), P(240, 100), P(240, 140));
      b.path(P(240, 140), P(260, 140));
      b.path(P(340, 140), P(360, 140), P(360, 120));
      b.path(P(360, 40), P(360, 20));
      b.path(P(0, 40), P(0, 240), P(400, 240), P(400, 40));
      b.path(P(240, 220), P(240, 240));
      return b.done();
    },
  },
];

/**
 * Transistor LC oscillators. One NPN common-emitter stage; the tank and its feedback differ:
 * - tuned: tank on the collector (transformer primary ∥ C), feedback from the secondary.
 * - hartley: tank = two coils in series with a C across both; the tap between them is grounded.
 * - colpitts: tank = two capacitors in series with an L across both; the tap is grounded.
 */
function oscillator(id: string, ar: string, en: string, ref: string, kind: 'tuned' | 'hartley' | 'colpitts'): Example {
  return {
    id,
    grade: 2,
    ar,
    en,
    ref,
    scopeWindow: 0.005,
    build() {
      const b = new Builder(ar);
      b.add('resistor', 0, -120, 1, { R: 10000 });
      b.add('resistor', 0, 60, 1, { R: 10000 });
      b.add('npn', 60, 0, 0, { beta: 150 });
      b.add('resistor', 80, 120, 1, { R: 1000 });
      b.add('ecap', 140, 120, 1, { C: 100e-6 });
      b.add('capacitor', -60, 0, 0, { C: 1e-6 });
      // A resistor in the feedback keeps the base current sensible while the oscillation grows.
      b.add('resistor', -140, 0, 0, { R: 1000 });
      b.add('probe', 80, -40, 0, { ch: '1' });
      b.path(P(0, -160), P(0, VCC_Y));
      b.path(P(0, 100), P(0, GND_Y));
      b.path(P(0, -80), P(0, 20));
      b.path(P(-20, 0), P(0, 0));
      b.path(P(0, 0), P(20, 0));
      b.path(P(80, 40), P(80, 80));
      b.path(P(80, 40), P(140, 40), P(140, 80));
      b.path(P(80, 160), P(80, GND_Y));
      b.path(P(140, 160), P(140, GND_Y));
      // The feedback point that returns to the base coupling capacitor.
      let fb: Pt;
      if (kind === 'tuned') {
        // f0 = 1 / (2π√(L1·C)) with L1 = 100 mH, C = 220 nF ≈ 1.07 kHz.
        b.add('transformer', 200, -120, 0, { n: 4, L1: 0.1 });
        b.add('capacitor', 120, -120, 1, { C: 220e-9 });
        b.add('ground', 280, -80);
        b.path(P(160, -160), P(160, VCC_Y));
        b.path(P(120, -160), P(160, -160));
        b.path(P(120, -80), P(160, -80));
        b.path(P(160, -80), P(160, -40), P(80, -40));
        b.path(P(240, -80), P(280, -80));
        fb = P(240, -160);
      } else {
        // The collector drives one end of the tank through a capacitor; the other end feeds the
        // base, and the centre tap is grounded, so the two ends are 180° apart.
        b.add('resistor', 80, -120, 1, { R: 1000 });
        b.add('capacitor', 160, -40, 0, { C: 1e-6 });
        b.path(P(80, -160), P(80, VCC_Y));
        b.path(P(80, -80), P(80, -40), P(120, -40));
        b.add('ground', 300, 40);
        if (kind === 'hartley') {
          // f0 = 1 / (2π√((L1 + L2)·C)) with 50 mH + 50 mH and 220 nF ≈ 1.07 kHz.
          b.add('inductor', 260, 0, 1, { L: 0.05, Rs: 5 });
          b.add('inductor', 260, 80, 1, { L: 0.05, Rs: 5 });
          b.add('capacitor', 340, 40, 1, { C: 220e-9 });
        } else {
          // f0 = 1 / (2π√(L·C1C2/(C1+C2))) with 100 mH and 470 nF + 470 nF ≈ 1.04 kHz.
          b.add('capacitor', 260, 0, 1, { C: 470e-9 });
          b.add('capacitor', 260, 80, 1, { C: 470e-9 });
          b.add('inductor', 340, 40, 1, { L: 0.1, Rs: 5 });
        }
        b.path(P(200, -40), P(260, -40));
        b.path(P(260, -40), P(340, -40), P(340, 0));
        b.path(P(260, 40), P(300, 40));
        b.path(P(260, 120), P(340, 120), P(340, 80));
        fb = P(260, 120);
        b.path(fb, P(260, 240), P(-220, 240), P(-220, 0), P(-180, 0));
        supply(b, 460, 6);
        return b.done();
      }
      b.path(fb, P(240, -240), P(-220, -240), P(-220, 0), P(-180, 0));
      supply(b, 460, 6);
      return b.done();
    },
  };
}

/** Passive RC wave shaper driven by a square wave: series part first, then the shunt part. */
function rcShaper(id: string, ar: string, en: string, ref: string, series: string, shunt: string): Example {
  const value = (type: string): Record<string, number> => (type === 'resistor' ? { R: 1000 } : { C: 1e-6 });
  return {
    id,
    grade: 2,
    ar,
    en,
    ref,
    scopeWindow: 0.005,
    build() {
      const b = new Builder(ar);
      // RC = 1 ms. Try the generator at 100 Hz and at 2 kHz to see the shape change.
      b.add('funcgen', 0, 0, 0, { wave: 'square', Vp: 5, f: 500, r: 50 });
      b.add('ground', 0, 40);
      b.add(series, 100, -80, 0, value(series));
      b.add(shunt, 200, 0, 1, value(shunt));
      b.add('probe', 0, -80, 0, { ch: '1' });
      b.add('probe', 200, -80, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, 40), P(0, 40));
      return b.done();
    },
  };
}

/**
 * Transmission line fed by a 75 Ω generator. `end` is a load in ohms, 'short' or 'open'.
 * Pulses show reflections in time; a sine shows the phase delay and standing waves.
 */
function tlineExample(id: string, ar: string, en: string, ref: string, end: number | 'short' | 'open', sine = false, loss = 0): Example {
  return {
    id,
    grade: 2,
    ar,
    en,
    ref,
    scopeWindow: sine ? 0.0004 : 0.001,
    build() {
      const b = new Builder(ar);
      const gen: Record<string, string | number> = sine ? { wave: 'sine', Vp: 2, f: 5000, r: 75 } : { wave: 'pulse', Vp: 5, f: 500, duty: 0.05, r: 75 };
      b.add('funcgen', 0, 40, 0, gen);
      b.add('ground', 0, 80);
      b.add('tline', 240, 0, 0, { Z0: 75, Td: 100e-6, loss });
      b.add('probe', 180, -60, 0, { ch: '1' });
      b.add('probe', 380, -60, 0, { ch: '2' });
      b.path(P(0, 0), P(0, -20), P(180, -20));
      b.path(P(180, -20), P(180, -60));
      b.path(P(180, 20), P(180, 80), P(0, 80));
      b.path(P(300, -20), P(380, -20), P(380, -60));
      b.path(P(300, 20), P(300, 80), P(180, 80));
      if (typeof end === 'number') {
        b.add('resistor', 380, 20, 1, { R: end });
        b.path(P(380, 60), P(380, 80), P(300, 80));
      } else if (end === 'short') {
        b.path(P(380, -20), P(380, 80), P(300, 80));
      }
      return b.done();
    },
  };
}
