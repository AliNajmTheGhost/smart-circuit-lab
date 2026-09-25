import { Builder } from './model/docops';
import type { Bilingual } from './model/library';
import type { CircuitDoc } from './model/types';

export interface Example extends Bilingual {
  id: string;
  /** Exercise in the grade-1 practical training book, when it matches one. */
  ref?: string;
  scopeWindow?: number;
  build: () => CircuitDoc;
}

const P = (x: number, y: number) => ({ x, y });

export const EXAMPLES: Example[] = [
  {
    id: 'lamp',
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
];
