import { Builder } from './model/docops';
import type { Bilingual } from './model/library';
import type { CircuitDoc } from './model/types';

export interface Example extends Bilingual {
  id: string;
  /** School year the exercise belongs to (1–3). */
  grade?: number;
  /** Exercise in the grade-1 practical training book, when it matches one. */
  ref?: string;
  scopeWindow?: number;
  build: () => CircuitDoc;
}

const P = (x: number, y: number) => ({ x, y });

export const EXAMPLES: Example[] = [
  {
    id: 'lamp',
    grade: 1,
    ar: 'مصباح وبطارية ومفتاح',
    en: 'Lamp, battery and switch',
    ref: '6',
    build() {
      const b = new Builder('مصباح وبطارية ومفتاح');
      b.add('battery', 0, 0, 0, { V: 12 });
      b.add('ground', 0, 40);
      b.add('switch', 120, -80);
      b.add('lamp', 240, 0, 1, { V: 12, P: 10 });
      b.add('voltmeter', 380, 0, 1);
      b.path(P(0, -40), P(0, -80), P(80, -80));
      b.path(P(160, -80), P(240, -80), P(240, -40), P(380, -40));
      b.path(P(380, 40), P(240, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'divider',
    grade: 1,
    ar: 'توصيل المقاومات على التوالي (مقسم الجهد)',
    en: 'Series resistors (voltage divider)',
    ref: '10–11',
    build() {
      const b = new Builder('مقسم الجهد');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 100);
      b.add('ammeter', 100, -100);
      b.add('resistor', 200, -60, 1, { R: 1000 });
      b.add('resistor', 200, 60, 1, { R: 2000 });
      b.add('voltmeter', 320, 60, 1);
      b.path(P(0, -40), P(0, -100), P(60, -100));
      b.path(P(140, -100), P(200, -100));
      b.path(P(200, -20), P(200, 20), P(320, 20));
      b.path(P(0, 40), P(0, 100), P(200, 100), P(320, 100));
      return b.done();
    },
  },
  {
    id: 'led',
    grade: 1,
    ar: 'تشغيل ثنائي باعث للضوء LED',
    en: 'Lighting an LED',
    ref: '25',
    build() {
      const b = new Builder('LED');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 40);
      b.add('resistor', 100, -80, 0, { R: 470 });
      b.add('led', 200, 0, 1, { color: 'red' });
      b.add('ammeter', 100, 40, 2);
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, 40), P(140, 40));
      b.path(P(60, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'rc',
    grade: 1,
    ar: 'شحن المتسعة وتفريغها',
    en: 'Charging and discharging a capacitor',
    ref: '14',
    scopeWindow: 1,
    build() {
      const b = new Builder('شحن المتسعة');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 40);
      b.add('switch', 100, -80);
      b.add('resistor', 220, -80, 0, { R: 1000 });
      b.add('ecap', 300, 0, 1, { C: 100e-6 });
      b.add('button', 420, -80);
      b.add('resistor', 460, 0, 1, { R: 100 });
      b.add('probe', 300, -80);
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(180, -80));
      b.path(P(260, -80), P(300, -80), P(300, -40));
      b.path(P(300, -80), P(380, -80));
      b.path(P(460, -80), P(460, -40));
      b.path(P(460, 40), P(300, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'halfwave',
    grade: 1,
    ar: 'تقويم نصف الموجة',
    en: 'Half-wave rectifier',
    ref: '31',
    scopeWindow: 0.05,
    build() {
      const b = new Builder('تقويم نصف الموجة');
      b.add('ac', 0, 0, 0, { Vp: 12, f: 50 });
      b.add('ground', 0, 40);
      b.add('diode', 100, -80);
      b.add('resistor', 200, 0, 1, { R: 1000 });
      b.add('switch', 300, -80, 1);
      b.add('ecap', 300, 0, 1, { C: 100e-6 });
      b.add('probe', 0, -80, 0, { ch: '1' });
      b.add('probe', 200, -80, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, -80), P(200, -140), P(300, -140), P(300, -120));
      b.path(P(300, 40), P(200, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'bridge',
    grade: 1,
    ar: 'تقويم الموجة الكاملة (القنطرة)',
    en: 'Full-wave bridge rectifier',
    ref: '31',
    scopeWindow: 0.05,
    build() {
      const b = new Builder('تقويم الموجة الكاملة');
      b.add('ac', 0, 0, 0, { Vp: 12, f: 50 });
      b.add('diode', 120, -80, 3);
      b.add('diode', 120, 0, 3);
      b.add('diode', 240, -80, 3);
      b.add('diode', 240, 0, 3);
      b.add('resistor', 440, -40, 1, { R: 1000 });
      b.add('ground', 440, 40);
      b.add('probe', 440, -120, 0, { ch: '2' });
      b.path(P(0, -40), P(120, -40));
      b.path(P(0, 40), P(0, 120), P(360, 120), P(360, -40), P(240, -40));
      b.path(P(120, -120), P(440, -120), P(440, -80));
      b.path(P(120, 40), P(440, 40), P(440, 0));
      return b.done();
    },
  },
  {
    id: 'zener',
    grade: 1,
    ar: 'تنظيم الجهد بثنائي زينر',
    en: 'Zener voltage regulator',
    ref: '27',
    build() {
      const b = new Builder('منظم زينر');
      b.add('battery', 0, 0, 0, { V: 12 });
      b.add('ground', 0, 40);
      b.add('resistor', 100, -80, 0, { R: 470 });
      b.add('zener', 200, 0, 3, { Vz: 5.1 });
      b.add('resistor', 300, 0, 1, { R: 1000 });
      b.add('voltmeter', 400, 0, 1);
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, -80), P(300, -80), P(300, -40));
      b.path(P(300, -80), P(400, -80), P(400, -40));
      b.path(P(400, 40), P(300, 40), P(200, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'transistor',
    grade: 1,
    ar: 'الترانزستور مفتاحاً',
    en: 'Transistor as a switch',
    ref: '33',
    build() {
      const b = new Builder('الترانزستور مفتاحاً');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 40);
      b.add('npn', 280, 0);
      b.add('led', 300, -80, 1, { color: 'green' });
      b.add('resistor', 300, -200, 1, { R: 470 });
      b.add('resistor', 200, 0, 0, { R: 10000 });
      b.add('switch', 100, 0);
      b.path(P(0, -40), P(0, -240), P(300, -240));
      b.path(P(300, -160), P(300, -120));
      b.path(P(60, -240), P(60, 0));
      b.path(P(140, 0), P(160, 0));
      b.path(P(300, 40), P(0, 40));
      return b.done();
    },
  },
  {
    id: 'ce-amp',
    grade: 1,
    ar: 'مكبر الباعث المشترك',
    en: 'Common-emitter amplifier',
    ref: '35',
    scopeWindow: 0.005,
    build() {
      const b = new Builder('مكبر الباعث المشترك');
      b.add('battery', 560, -40, 0, { V: 12 });
      b.add('ground', 560, 120);
      b.add('npn', 300, 0, 0, { beta: 150 });
      b.add('resistor', 200, -120, 1, { R: 47000 });
      b.add('resistor', 200, 80, 1, { R: 10000 });
      b.add('resistor', 320, -120, 1, { R: 4700 });
      b.add('resistor', 320, 80, 1, { R: 1000 });
      b.add('ecap', 400, 80, 1, { C: 100e-6 });
      b.add('ecap', 120, 0, 2, { C: 10e-6 });
      b.add('ecap', 400, -40, 0, { C: 10e-6 });
      b.add('resistor', 480, 0, 1, { R: 10000 });
      b.add('funcgen', 0, 40, 0, { wave: 'sine', Vp: 0.01, f: 1000, r: 50 });
      b.add('probe', 0, 0, 0, { ch: '1' });
      b.add('probe', 480, -40, 0, { ch: '2' });
      b.path(P(560, -80), P(560, -200), P(200, -200), P(200, -160));
      b.path(P(320, -200), P(320, -160));
      b.path(P(200, -80), P(200, 0), P(260, 0));
      b.path(P(200, 0), P(200, 40));
      b.path(P(160, 0), P(200, 0));
      b.path(P(0, 0), P(80, 0));
      b.path(P(320, -80), P(320, -40), P(360, -40));
      b.path(P(320, 40), P(400, 40));
      b.path(P(440, -40), P(480, -40));
      b.path(P(480, 40), P(480, 120));
      b.path(P(0, 80), P(0, 120), P(560, 120), P(560, 0));
      return b.done();
    },
  },
  {
    id: 'gates',
    grade: 1,
    ar: 'البوابات المنطقية AND و OR و XOR',
    en: 'Logic gates AND, OR, XOR',
    ref: '37–42',
    build() {
      const b = new Builder('البوابات المنطقية');
      b.add('logicin', 0, -60);
      b.add('logicin', 0, 60);
      b.add('and', 200, -120);
      b.add('or', 200, 0);
      b.add('xor', 200, 120);
      b.add('logicout', 320, -120);
      b.add('logicout', 320, 0);
      b.add('logicout', 320, 120);
      b.path(P(40, -60), P(80, -60));
      b.path(P(80, -140), P(80, 100));
      b.path(P(80, -140), P(160, -140));
      b.path(P(80, -20), P(160, -20));
      b.path(P(80, 100), P(160, 100));
      b.path(P(40, 60), P(120, 60));
      b.path(P(120, -100), P(120, 140));
      b.path(P(120, -100), P(160, -100));
      b.path(P(120, 20), P(160, 20));
      b.path(P(120, 140), P(160, 140));
      b.path(P(240, -120), P(280, -120));
      b.path(P(240, 0), P(280, 0));
      b.path(P(240, 120), P(280, 120));
      return b.done();
    },
  },
  {
    id: 'ohmmeter',
    grade: 1,
    ar: 'قياس المقاومة بالأفوميتر',
    en: 'Measuring resistance with the multimeter',
    ref: '7–9',
    build() {
      const b = new Builder('قياس المقاومة');
      b.add('multimeter', 60, 0, 0, { mode: 'ohm' });
      b.add('resistor', 20, 160, 0, { R: 1000 });
      b.add('resistor', 100, 160, 0, { R: 2200 });
      b.path(P(40, 60), P(40, 100), P(-20, 100), P(-20, 160));
      b.path(P(80, 60), P(80, 100), P(140, 100), P(140, 160));
      return b.done();
    },
  },
  {
    id: 'psu',
    grade: 1,
    ar: 'مجهز القدرة وحد التيار',
    en: 'Power supply and current limit',
    ref: '1',
    build() {
      const b = new Builder('مجهز القدرة');
      b.add('psu', 0, 0, 0, { V: 12, Ilim: 0.2 });
      b.add('ground', 0, 40);
      b.add('lamp', 180, 0, 1, { V: 12, P: 5 });
      b.path(P(0, -40), P(180, -40));
      b.path(P(0, 40), P(180, 40));
      return b.done();
    },
  },
  {
    id: 'transformer',
    grade: 1,
    ar: 'المحولة الخافضة 220V إلى 12V',
    en: 'Step-down transformer 220 V to 12 V',
    ref: '17',
    build() {
      const b = new Builder('المحولة');
      b.add('ac', 0, 0, 0, { Vp: 311, f: 50, r: 0.5 });
      b.add('ground', 0, 40);
      b.add('transformer', 200, 0, 0, { n: 18.3 });
      b.add('lamp', 320, 0, 1, { V: 12, P: 5 });
      b.add('multimeter', 500, -20, 0, { mode: 'vac' });
      b.path(P(0, -40), P(0, -80), P(160, -80), P(160, -40));
      b.path(P(0, 40), P(160, 40));
      b.path(P(240, -40), P(320, -40));
      b.path(P(240, 40), P(320, 40), P(480, 40));
      b.path(P(520, 40), P(540, 40), P(540, -80), P(320, -80), P(320, -40));
      return b.done();
    },
  },
  {
    id: 'ldr-night',
    grade: 1,
    ar: 'مصباح ليلي بمقاومة ضوئية',
    en: 'Night light with an LDR',
    ref: '28–29',
    build() {
      const b = new Builder('مصباح ليلي');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 80);
      b.add('resistor', 120, -80, 1, { R: 47000 });
      b.add('ldr', 120, 40, 1, { light: 1 });
      b.add('resistor', 180, 0, 0, { R: 1000 });
      b.add('npn', 260, 0);
      b.add('led', 280, -80, 1, { color: 'yellow' });
      b.add('resistor', 280, -160, 1, { R: 470 });
      b.path(P(0, -40), P(0, -200), P(280, -200));
      b.path(P(120, -200), P(120, -120));
      b.path(P(120, -40), P(120, 0), P(140, 0));
      b.path(P(0, 40), P(0, 80), P(280, 80), P(280, 40));
      return b.done();
    },
  },
  {
    id: 'scr',
    grade: 2,
    ar: 'الثايرستور: قفل التشغيل',
    en: 'SCR latch',
    ref: 'الوحدة 7',
    build() {
      const b = new Builder('الثايرستور');
      b.add('battery', 0, 0, 0, { V: 12 });
      b.add('ground', 0, 40);
      b.add('switch', 60, -80, 0, { closed: 1 });
      b.add('lamp', 160, -80, 0, { V: 12, P: 5 });
      b.add('scr', 280, 0, 1);
      b.add('resistor', 160, 20, 0, { R: 1000 });
      b.add('button', 80, 20);
      b.path(P(0, -40), P(0, -80), P(20, -80));
      b.path(P(100, -80), P(120, -80));
      b.path(P(200, -80), P(280, -80), P(280, -40));
      b.path(P(280, 40), P(0, 40));
      b.path(P(200, 20), P(240, 20));
      b.path(P(40, 20), P(40, -60), P(0, -60));
      return b.done();
    },
  },
  {
    id: 'triac',
    grade: 2,
    ar: 'التحكم بإضاءة مصباح بالترياك',
    en: 'Lamp dimmer with a triac',
    ref: '37',
    scopeWindow: 0.05,
    build() {
      const b = new Builder('الترياك');
      b.add('ac', 0, 0, 0, { Vp: 24, f: 50 });
      b.add('ground', 0, 40);
      b.add('lamp', 160, -80, 0, { V: 24, P: 10 });
      b.add('triac', 280, 0, 1);
      b.add('resistor', 80, 20, 0, { R: 470 });
      b.add('pot', 160, 20, 0, { R: 5000, pos: 0.2 });
      b.add('probe', 200, -80, 0, { ch: '1' });
      b.path(P(0, -40), P(0, -80), P(120, -80));
      b.path(P(200, -80), P(280, -80), P(280, -40));
      b.path(P(280, 40), P(0, 40));
      b.path(P(40, -80), P(40, 20));
      b.path(P(160, -20), P(240, -20), P(240, 20));
      b.path(P(200, 20), P(200, -20));
      return b.done();
    },
  },
  {
    id: '555',
    grade: 2,
    ar: 'المؤقت 555: متعدد الاهتزاز الحر',
    en: '555 astable (blinking LED)',
    ref: '14',
    scopeWindow: 0.2,
    build() {
      const b = new Builder('المؤقت 555');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 160);
      b.add('timer555', 300, 0);
      b.add('resistor', 160, -120, 1, { R: 1000 });
      b.add('resistor', 160, 0, 1, { R: 47000 });
      b.add('capacitor', 160, 120, 1, { C: 1e-6 });
      b.add('resistor', 400, 0, 0, { R: 470 });
      b.add('led', 440, 40, 1, { color: 'red' });
      b.add('probe', 160, 80, 0, { ch: '1' });
      b.add('probe', 360, 0, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -160), P(320, -160));
      b.path(P(280, -80), P(280, -160));
      b.path(P(320, -80), P(320, -160));
      b.path(P(160, -80), P(160, -40), P(240, -40));
      b.path(P(160, 40), P(240, 40));
      b.path(P(240, 0), P(240, 40));
      b.path(P(160, 40), P(160, 80));
      b.path(P(0, 40), P(0, 160), P(440, 160), P(440, 80));
      b.path(P(300, 80), P(300, 160));
      return b.done();
    },
  },
  {
    id: 'tone-555',
    grade: 2,
    ar: 'مولد نغمات بالمؤقت 555 والسماعة',
    en: '555 tone generator with a speaker',
    scopeWindow: 0.005,
    build() {
      // Same circuit as the blinking LED with a 100 nF capacitor: about 1.4 kHz you can hear.
      // Change R2 or C1 and the pitch changes.
      const b = new Builder('مولد نغمات');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 160);
      b.add('timer555', 300, 0);
      b.add('resistor', 160, -120, 1, { R: 1000 });
      b.add('resistor', 160, 0, 1, { R: 4700 });
      b.add('capacitor', 160, 120, 1, { C: 100e-9 });
      b.add('resistor', 400, 0, 0, { R: 100 });
      b.add('speaker', 440, 40, 1);
      b.add('probe', 360, 0, 0, { ch: '1' });
      b.path(P(0, -40), P(0, -160), P(320, -160));
      b.path(P(280, -80), P(280, -160));
      b.path(P(320, -80), P(320, -160));
      b.path(P(160, -80), P(160, -40), P(240, -40));
      b.path(P(160, 40), P(240, 40));
      b.path(P(240, 0), P(240, 40));
      b.path(P(160, 40), P(160, 80));
      b.path(P(0, 40), P(0, 160), P(440, 160), P(440, 80));
      b.path(P(300, 80), P(300, 160));
      return b.done();
    },
  },
  {
    id: 'counter',
    grade: 2,
    ar: 'عداد مع عارضة القطع السبع',
    en: 'Counter with a 7-segment display',
    ref: '32',
    build() {
      const b = new Builder('العداد');
      b.add('funcgen', 0, 0, 0, { wave: 'pulse', Vp: 5, f: 10, duty: 0.5, r: 1 });
      b.add('ground', 0, 40);
      b.add('counter', 160, -40);
      b.add('bcd7', 340, -40);
      b.add('sevenseg', 480, -40);
      b.add('ground', 480, 60);
      b.path(P(0, -40), P(0, -80), P(100, -80));
      for (const y of [-80, -60, -40, -20]) b.path(P(220, y), P(280, y));
      for (let y = -100; y <= 20; y += 20) b.path(P(400, y), P(440, y));
      return b.done();
    },
  },
  {
    id: 'am',
    grade: 2,
    ar: 'كشف إشارة AM بالثنائي',
    en: 'AM envelope detector',
    ref: 'الوحدة 4',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('كاشف AM');
      b.add('funcgen', 0, 0, 0, { wave: 'am', Vp: 2, f: 5000, fm: 200, m: 0.6, r: 50 });
      b.add('ground', 0, 40);
      b.add('schottky', 100, -80);
      b.add('capacitor', 200, 0, 1, { C: 47e-9 });
      b.add('resistor', 300, 0, 1, { R: 10000 });
      b.add('probe', 0, -80, 0, { ch: '1' });
      b.add('probe', 200, -80, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, -80), P(300, -80), P(300, -40));
      b.path(P(300, 40), P(200, 40), P(0, 40));
      return b.done();
    },
  },
  filterExample('lowpass', 'مرشح إمرار الترددات الواطئة RC', 'RC low-pass filter', '6', 'resistor', 'capacitor'),
  filterExample('highpass', 'مرشح إمرار الترددات العالية RC', 'RC high-pass filter', '7', 'capacitor', 'resistor'),
  {
    id: 'bandpass',
    grade: 3,
    ar: 'مرشح إمرار حزمة RLC',
    en: 'RLC band-pass filter',
    ref: '8',
    build() {
      const b = new Builder('مرشح إمرار حزمة');
      b.add('funcgen', 0, 0, 0, { wave: 'sine', Vp: 1, f: 1600, r: 50 });
      b.add('ground', 0, 40);
      b.add('inductor', 100, -80, 0, { L: 0.01, Rs: 1 });
      b.add('capacitor', 180, -80, 0, { C: 1e-6 });
      b.add('resistor', 260, 0, 1, { R: 100 });
      b.add('bode', 120, -200, 0, { fmin: 10, fmax: 100000 });
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(220, -80), P(260, -80), P(260, -40));
      b.path(P(260, 40), P(0, 40));
      b.path(P(100, -160), P(0, -160), P(0, -80));
      b.path(P(140, -160), P(260, -160), P(260, -80));
      return b.done();
    },
  },
  {
    id: 'phase-shift',
    grade: 2,
    ar: 'مذبذب إزاحة الطور RC',
    en: 'RC phase-shift oscillator',
    ref: '7',
    scopeWindow: 0.01,
    build() {
      const b = new Builder('مذبذب إزاحة الطور');
      b.add('opamp', 500, 0);
      b.add('ground', 460, 20);
      b.add('resistor', 500, -80, 0, { R: 330000 });
      b.add('resistor', 400, -20, 0, { R: 10000 });
      b.add('capacitor', 460, 120, 0, { C: 10e-9 });
      b.add('resistor', 420, 160, 1, { R: 10000 });
      b.add('ground', 420, 200);
      b.add('capacitor', 380, 120, 0, { C: 10e-9 });
      b.add('resistor', 340, 160, 1, { R: 10000 });
      b.add('ground', 340, 200);
      b.add('capacitor', 300, 120, 0, { C: 10e-9 });
      b.add('probe', 540, 0, 0, { ch: '1' });
      b.add('probe', 260, 120, 0, { ch: '2' });
      b.path(P(460, -20), P(460, -80));
      b.path(P(540, -80), P(540, 0), P(540, 120), P(500, 120));
      b.path(P(440, -20), P(460, -20));
      b.path(P(260, 120), P(260, -20), P(360, -20));
      return b.done();
    },
  },
  {
    id: 'lcd-counter',
    grade: 2,
    ar: 'عداد مع عارضة LCD',
    en: 'Counter with an LCD display',
    ref: '33',
    build() {
      const b = new Builder('عارضة LCD');
      b.add('funcgen', 0, 0, 0, { wave: 'pulse', Vp: 5, f: 10, duty: 0.5, r: 1 });
      b.add('ground', 0, 40);
      b.add('counter', 160, -40);
      b.add('bcd7', 340, -40);
      b.add('lcd7', 480, -40);
      b.add('ground', 480, 60);
      b.path(P(0, -40), P(0, -80), P(100, -80));
      for (const y of [-80, -60, -40, -20]) b.path(P(220, y), P(280, y));
      for (let y = -100; y <= 20; y += 20) b.path(P(400, y), P(440, y));
      return b.done();
    },
  },
  {
    id: 'ir-remote',
    grade: 3,
    ar: 'التحكم عن بعد بالأشعة تحت الحمراء',
    en: 'Infrared remote control',
    ref: '21',
    build() {
      const b = new Builder('التحكم بالأشعة تحت الحمراء');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 120);
      b.add('button', 120, -160, 1);
      b.add('resistor', 120, -80, 1, { R: 330 });
      b.add('irtx', 120, 0, 1, { ch: '1' });
      b.add('irrx', 300, -160, 3, { ch: '1' });
      b.add('resistor', 300, 40, 1, { R: 10000 });
      b.add('resistor', 340, 0, 0, { R: 4700 });
      b.add('npn', 420, 0);
      b.add('led', 440, -80, 1, { color: 'green' });
      b.add('resistor', 440, -160, 1, { R: 470 });
      b.path(P(0, -40), P(0, -200), P(440, -200));
      b.path(P(300, -120), P(300, 0));
      b.path(P(0, 40), P(0, 120), P(440, 120), P(440, 40));
      b.path(P(120, 40), P(120, 120));
      b.path(P(300, 80), P(300, 120));
      return b.done();
    },
  },
  {
    id: 'tdm',
    grade: 3,
    ar: 'الإكثار بالتقسيم الزمني TDM',
    en: 'Time-division multiplexing',
    ref: '11',
    scopeWindow: 0.05,
    build() {
      const b = new Builder('الإكثار الزمني');
      b.add('funcgen', 0, -60, 0, { wave: 'sine', Vp: 2, f: 50, r: 50 });
      b.add('ground', 0, -20);
      b.add('funcgen', 60, 100, 0, { wave: 'triangle', Vp: 2, f: 30, r: 50 });
      b.add('ground', 60, 140);
      b.add('funcgen', 340, 120, 0, { wave: 'pulse', Vp: 5, f: 1000, duty: 0.5, r: 1 });
      b.add('ground', 340, 160);
      b.add('aswitch', 200, 0);
      b.add('aswitch', 500, 0);
      b.add('capacitor', 400, -60, 1, { C: 1e-6 });
      b.add('ground', 400, -100);
      b.add('capacitor', 400, 60, 1, { C: 1e-6 });
      b.add('ground', 400, 100);
      b.add('probe', 260, -140, 0, { ch: '1' });
      b.add('probe', 400, -20, 0, { ch: '2' });
      b.path(P(0, -100), P(120, -100), P(120, -20), P(160, -20));
      b.path(P(60, 60), P(60, 20), P(160, 20));
      b.path(P(240, 0), P(260, 0), P(260, -140), P(580, -140), P(580, 0), P(540, 0));
      b.path(P(460, -20), P(400, -20));
      b.path(P(460, 20), P(400, 20));
      b.path(P(200, 40), P(200, 80), P(500, 80), P(500, 40));
      return b.done();
    },
  },
  {
    id: 'fdm',
    grade: 3,
    ar: 'الإكثار بالتقسيم الترددي FDM',
    en: 'Frequency-division multiplexing',
    ref: '10',
    scopeWindow: 0.02,
    build() {
      const b = new Builder('الإكثار الترددي');
      b.add('funcgen', 0, -60, 0, { wave: 'am', Vp: 2, f: 5000, fm: 100, m: 0.6, r: 50 });
      b.add('ground', 0, -20);
      b.add('funcgen', 0, 100, 0, { wave: 'am', Vp: 2, f: 20000, fm: 150, m: 0.6, r: 50 });
      b.add('ground', 0, 140);
      b.add('resistor', 100, -100, 0, { R: 1000 });
      b.add('resistor', 100, 60, 0, { R: 1000 });
      b.add('resistor', 180, 120, 1, { R: 1000 });
      b.add('ground', 180, 160);
      b.add('inductor', 260, -100, 0, { L: 0.1, Rs: 1 });
      b.add('capacitor', 340, -100, 0, { C: 10e-9 });
      b.add('resistor', 420, -60, 1, { R: 100 });
      b.add('ground', 420, -20);
      b.add('inductor', 260, 20, 0, { L: 0.1, Rs: 1 });
      b.add('capacitor', 340, 20, 0, { C: 680e-12 });
      b.add('resistor', 420, 60, 1, { R: 100 });
      b.add('ground', 420, 100);
      b.add('probe', 180, -100, 0, { ch: '1' });
      b.add('probe', 420, -100, 0, { ch: '2' });
      b.path(P(0, -100), P(60, -100));
      b.path(P(0, 60), P(60, 60));
      b.path(P(140, -100), P(180, -100), P(180, 80));
      b.path(P(140, 60), P(180, 60));
      b.path(P(180, -100), P(220, -100));
      b.path(P(380, -100), P(420, -100));
      b.path(P(180, 20), P(220, 20));
      b.path(P(380, 20), P(420, 20));
      return b.done();
    },
  },
  opampExample('opamp-inv', 'مكبر العمليات العاكس (الكسب −10)', 'Inverting op-amp amplifier (gain −10)', 'الوحدة 1', 'resistor', { R: 1000 }, { R: 10000 }, { wave: 'sine', Vp: 0.5, f: 1000 }),
  opampExample('integrator', 'دائرة المكامل بمكبر العمليات', 'Op-amp integrator', '12', 'resistor', { R: 10000 }, { C: 100e-9 }, { wave: 'square', Vp: 1, f: 1000 }),
  opampExample('differentiator', 'دائرة المفاضل بمكبر العمليات', 'Op-amp differentiator', '11', 'capacitor', { C: 100e-9 }, { R: 10000 }, { wave: 'triangle', Vp: 1, f: 1000 }),
  {
    id: 'adc-dac',
    grade: 3,
    ar: 'التحويل التماثلي ↔ الرقمي',
    en: 'Analogue ↔ digital conversion',
    ref: '13–14',
    scopeWindow: 0.2,
    build() {
      const b = new Builder('التحويل A/D و D/A');
      b.add('funcgen', 0, 40, 0, { wave: 'sine', Vp: 2.4, offset: 2.5, f: 5, r: 1 });
      b.add('ground', 0, 80);
      b.add('funcgen', 60, 120, 0, { wave: 'pulse', Vp: 5, f: 100, duty: 0.5, r: 1 });
      b.add('ground', 60, 160);
      b.add('adc', 180, 0);
      b.add('dac', 360, 0);
      b.add('probe', 0, -20, 0, { ch: '1' });
      b.add('probe', 420, -20, 0, { ch: '2' });
      b.path(P(0, 0), P(0, -20), P(120, -20));
      b.path(P(60, 80), P(60, 20), P(120, 20));
      for (const y of [-40, -20, 0, 20]) b.path(P(240, y), P(300, y));
      return b.done();
    },
  },
  {
    id: 'tline',
    grade: 2,
    ar: 'خط النقل: الانعكاس والتأخير',
    en: 'Transmission line: delay and reflection',
    ref: 'الوحدة 5',
    scopeWindow: 0.001,
    build() {
      const b = new Builder('خط النقل');
      b.add('funcgen', 0, 40, 0, { wave: 'pulse', Vp: 5, f: 500, duty: 0.1, r: 75 });
      b.add('ground', 0, 80);
      b.add('tline', 240, 0, 0, { Z0: 75, Td: 100e-6 });
      b.add('resistor', 380, 20, 1, { R: 75 });
      b.add('probe', 0, -20, 0, { ch: '1' });
      b.add('probe', 380, -20, 0, { ch: '2' });
      b.path(P(0, 0), P(0, -20), P(180, -20));
      b.path(P(180, 20), P(180, 80), P(0, 80));
      b.path(P(300, -20), P(380, -20));
      b.path(P(300, 20), P(300, 80), P(180, 80));
      b.path(P(380, 60), P(380, 80), P(300, 80));
      return b.done();
    },
  },
  twoSources('pulse-mod', 'التضمين النبضي PAM و PPM', 'Pulse modulation PAM and PPM', '15–18', { wave: 'pam', Vp: 5, f: 1000, fm: 50, m: 0.6, duty: 0.3 }, { wave: 'ppm', Vp: 5, f: 1000, fm: 50, duty: 0.1 }, 0.05),
  twoSources('digital-mod', 'التضمين الرقمي ASK و FSK', 'Digital modulation ASK and FSK', '19–20', { wave: 'ask', Vp: 2, f: 2000, fm: 200 }, { wave: 'fsk', Vp: 2, f: 1000, fm: 200, dev: 1000 }, 0.02),
];

/** Two generators, each loaded by 1 kΩ and watched on its own oscilloscope channel. */
function twoSources(id: string, ar: string, en: string, ref: string, a: Record<string, string | number>, c: Record<string, string | number>, scopeWindow: number): Example {
  return {
    id,
    grade: 3,
    ar,
    en,
    ref,
    scopeWindow,
    build() {
      const b = new Builder(ar);
      [a, c].forEach((params, i) => {
        const x = i * 200;
        b.add('funcgen', x, 0, 0, { ...params, r: 50 });
        b.add('ground', x, 40);
        b.add('resistor', x + 100, 0, 1, { R: 1000 });
        b.add('probe', x, -60, 0, { ch: String(i + 1) });
        b.path(P(x, -40), P(x, -60), P(x + 100, -60), P(x + 100, -40));
        b.path(P(x + 100, 40), P(x, 40));
      });
      return b.done();
    },
  };
}

/**
 * Inverting op-amp stage: input part from the generator to IN−, feedback part from IN− to the output.
 * The integrator also gets 1 MΩ across its capacitor so its output does not drift.
 */
function opampExample(
  id: string,
  ar: string,
  en: string,
  ref: string,
  inType: string,
  inParams: Record<string, number>,
  fbParams: Record<string, number>,
  source: Record<string, string | number>,
): Example {
  return {
    id,
    grade: 2,
    ar,
    en,
    ref,
    scopeWindow: 0.005,
    build() {
      const b = new Builder(ar);
      b.add('funcgen', 0, 40, 0, { ...source, r: 50 });
      b.add('ground', 0, 80);
      b.add(inType, 100, -20, 0, inParams);
      b.add('opamp', 200, 0);
      b.add('ground', 160, 20);
      const fbType = 'C' in fbParams ? 'capacitor' : 'resistor';
      b.add(fbType, 200, -80, 0, fbParams);
      if (fbType === 'capacitor') {
        b.add('resistor', 200, -140, 0, { R: 1e6 });
        b.path(P(160, -80), P(160, -140));
        b.path(P(240, -80), P(240, -140));
      }
      b.add('resistor', 280, 40, 1, { R: 10000 });
      b.add('ground', 280, 80);
      b.add('probe', 0, -20, 0, { ch: '1' });
      b.add('probe', 280, 0, 0, { ch: '2' });
      b.path(P(0, 0), P(0, -20), P(60, -20));
      b.path(P(140, -20), P(160, -20));
      b.path(P(160, -20), P(160, -80));
      b.path(P(240, -80), P(240, 0), P(280, 0));
      return b.done();
    },
  };
}

function filterExample(id: string, ar: string, en: string, ref: string, series: string, shunt: string): Example {
  const value = (type: string): Record<string, number> => (type === 'resistor' ? { R: 1000 } : { C: 100e-9 });
  return {
    id,
    grade: 3,
    ar,
    en,
    ref,
    scopeWindow: 0.002,
    build() {
      const b = new Builder(ar);
      b.add('funcgen', 0, 0, 0, { wave: 'sine', Vp: 1, f: 1000, r: 50 });
      b.add('ground', 0, 40);
      b.add(series, 100, -80, 0, value(series));
      b.add(shunt, 200, 0, 1, value(shunt));
      b.add('bode', 100, -200, 0, { fmin: 10, fmax: 100000 });
      b.add('probe', 0, -80, 0, { ch: '1' });
      b.add('probe', 200, -80, 0, { ch: '2' });
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(200, -80), P(200, -40));
      b.path(P(200, 40), P(0, 40));
      b.path(P(80, -160), P(0, -160), P(0, -80));
      b.path(P(120, -160), P(200, -160), P(200, -80));
      return b.done();
    },
  };
}
