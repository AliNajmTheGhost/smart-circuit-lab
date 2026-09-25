import { EXAMPLES } from '../examples';
import { Builder } from '../model/docops';
import type { Bilingual } from '../model/library';
import type { CircuitDoc, Part } from '../model/types';
import type { App } from '../ui/app';

export interface LessonCtx {
  parts(type: string): Part[];
  reading(p: Part): { v: number; i: number; p: number; extra: Record<string, number> } | null;
  broken(p: Part): boolean;
  num(p: Part, key: string): number;
}

export interface LessonStep extends Bilingual {
  hint?: Bilingual;
  /** Returns true when the student has done what the step asks. No check means "read and continue". */
  check?: (c: LessonCtx) => boolean;
}

export interface Lesson extends Bilingual {
  id: string;
  grade: number;
  /** Exercise number in the practical training book. */
  ref: string;
  goal: Bilingual;
  scopeWindow?: number;
  build: () => CircuitDoc;
  steps: LessonStep[];
}

const P = (x: number, y: number) => ({ x, y });
const near = (v: number, want: number, tol: number) => Math.abs(v - want) <= tol;
const meter = (c: LessonCtx, type: string) => {
  const m = c.parts(type)[0];
  return m ? (c.reading(m)?.extra.reading ?? NaN) : NaN;
};

export function lessonCtx(app: App): LessonCtx {
  return {
    parts: (type) => app.doc.parts.filter((p) => p.type === type),
    reading: (p) => app.engine.reading(p.id),
    broken: (p) => app.broken.has(p.id),
    num: (p, key) => Number(p.params[key]),
  };
}

export const LESSONS: Lesson[] = [
  {
    id: 'ohm',
    grade: 1,
    ref: '8',
    ar: 'قانون أوم',
    en: "Ohm's law",
    goal: { ar: 'التحقق من أن التيار = الجهد ÷ المقاومة.', en: 'Verify that current = voltage ÷ resistance.' },
    build() {
      const b = new Builder('قانون أوم');
      b.add('battery', 0, 0, 0, { V: 6 });
      b.add('ground', 0, 40);
      b.add('ammeter', 100, -80);
      b.add('resistor', 240, 0, 1, { R: 1000 });
      b.add('voltmeter', 340, 0, 1);
      b.path(P(0, -40), P(0, -80), P(60, -80));
      b.path(P(140, -80), P(240, -80), P(240, -40), P(340, -40));
      b.path(P(340, 40), P(240, 40), P(0, 40));
      return b.done();
    },
    steps: [
      {
        ar: 'أمامك بطارية 6V ومقاومة 1kΩ. الأميتر موصول على التوالي والفولتميتر على التوازي. اقرأ الأميتر: هل يساوي 6 ÷ 1000 = 6mA؟',
        en: 'A 6 V battery drives a 1 kΩ resistor. Read the ammeter: is it 6 ÷ 1000 = 6 mA?',
        check: (c) => near(meter(c, 'ammeter'), 0.006, 0.0003),
      },
      {
        ar: 'اضغط على المقاومة R1 وغيّر قيمتها إلى 2k. ماذا حدث للتيار؟',
        en: 'Click resistor R1 and change it to 2k. What happens to the current?',
        hint: { ar: 'اكتب 2k في خانة «المقاومة» في لوحة الخصائص ثم اضغط Enter.', en: 'Type 2k in the Resistance box and press Enter.' },
        check: (c) => c.parts('resistor').some((r) => near(c.num(r, 'R'), 2000, 1)) && near(meter(c, 'ammeter'), 0.003, 0.0002),
      },
      {
        ar: 'غيّر جهد البطارية إلى 12V. احسب التيار في دفترك أولاً: 12 ÷ 2000 = ؟ ثم تحقق من الأميتر.',
        en: 'Change the battery to 12 V. Work out 12 ÷ 2000 first, then check the ammeter.',
        check: (c) => c.parts('battery').some((b) => near(c.num(b, 'V'), 12, 0.01)) && near(meter(c, 'ammeter'), 0.006, 0.0003),
      },
      {
        ar: 'لاحظ: عندما تضاعفت المقاومة نقص التيار إلى النصف، وعندما تضاعف الجهد تضاعف التيار. هذا هو قانون أوم: I = V ÷ R.',
        en: 'Doubling R halved the current; doubling V doubled it. That is Ohm’s law: I = V ÷ R.',
      },
    ],
  },
  {
    id: 'led-safe',
    grade: 1,
    ref: '25',
    ar: 'تشغيل LED بأمان',
    en: 'Lighting an LED safely',
    goal: { ar: 'معرفة لماذا يحتاج الثنائي الضوئي مقاومة على التوالي.', en: 'Learn why an LED needs a series resistor.' },
    build() {
      const b = new Builder('LED بأمان');
      b.add('battery', 0, 0, 0, { V: 9 });
      b.add('ground', 0, 40);
      b.add('led', 240, 0, 1, { color: 'red' });
      b.path(P(0, -40), P(0, -80), P(240, -80), P(240, -40));
      b.path(P(240, 40), P(0, 40));
      return b.done();
    },
    steps: [
      {
        ar: 'الثنائي الضوئي LED1 موصول بالبطارية مباشرة. شغّل الدائرة وراقب ما يحدث، ثم اقرأ رسالة «طبيب الدائرة».',
        en: 'LED1 is wired straight to the battery. Run it and read the circuit doctor.',
        check: (c) => c.parts('led').some((l) => c.broken(l)),
      },
      {
        ar: 'اسحب «مقاومة» من القائمة وضعها فوق السلك العلوي، ثم غيّر قيمتها إلى 470. بعدها اضغط على LED1 ثم «استبدال القطعة التالفة».',
        en: 'Drop a resistor onto the top wire, set it to 470, then select LED1 and press “Replace damaged part”.',
        hint: {
          ar: 'عندما تضع المقاومة فوق السلك يدخلها البرنامج في السلك تلقائياً. التيار المناسب لـ LED بين 10 و 20mA.',
          en: 'Dropping a part on a wire inserts it. A good LED current is 10–20 mA.',
        },
        check: (c) =>
          c.parts('led').some((l) => {
            const i = c.reading(l)?.i ?? 0;
            return !c.broken(l) && i > 0.005 && i < 0.025;
          }) && c.parts('resistor').length > 0,
      },
      {
        ar: 'الآن يضيء بأمان. المقاومة تستهلك الجهد الزائد: (9 − 1.8) ÷ 470 ≈ 15mA. جرّب قيمة 220 ثم 1k ولاحظ شدة الإضاءة.',
        en: 'Now it glows safely: (9 − 1.8) ÷ 470 ≈ 15 mA. Try 220 and 1k and compare the brightness.',
      },
    ],
  },
  {
    id: 'cap-charge',
    grade: 1,
    ref: '14',
    ar: 'شحن المتسعة وتفريغها',
    en: 'Charging and discharging a capacitor',
    goal: { ar: 'مشاهدة شحن المتسعة وتفريغها عبر مقاومة على راسم الإشارة.', en: 'Watch a capacitor charge and discharge on the scope.' },
    scopeWindow: 1,
    build: () => EXAMPLES.find((e) => e.id === 'rc')!.build(),
    steps: [
      {
        ar: 'افتح «راسم الإشارة» من الشريط العلوي، ثم اضغط على المفتاح S1 لغلقه. راقب الجهد على المتسعة يرتفع تدريجياً.',
        en: 'Open the oscilloscope, then click switch S1 to close it. Watch the capacitor voltage rise.',
        check: (c) => c.parts('ecap').some((x) => (c.reading(x)?.v ?? 0) > 5.7),
      },
      {
        ar: 'بعد زمن واحد (τ = R × C = 1000 × 0.0001 = 0.1 ثانية) يصل الجهد إلى 63% من 9V، أي حوالي 5.7V. الآن افتح المفتاح S1 واضغط مطولاً على الزر S2 لتفريغ المتسعة.',
        en: 'After one time constant (τ = RC = 0.1 s) it reaches 63% of 9 V. Now open S1 and hold button S2 to discharge.',
        check: (c) => c.parts('switch').every((s) => c.num(s, 'closed') !== 1) && c.parts('ecap').some((x) => (c.reading(x)?.v ?? 9) < 1),
      },
      {
        ar: 'لاحظ أن التفريغ أسرع لأن مقاومة التفريغ 100Ω أصغر. غيّر المتسعة إلى 470µF وأعد التجربة: ماذا يحدث للزمن؟',
        en: 'Discharge is faster through 100 Ω. Try a 470 µF capacitor: what happens to the time?',
      },
    ],
  },
  {
    id: 'and-gate',
    grade: 1,
    ref: '37',
    ar: 'بوابة AND',
    en: 'AND gate',
    goal: { ar: 'استخراج جدول الحقيقة لبوابة AND.', en: 'Find the truth table of an AND gate.' },
    build() {
      const b = new Builder('بوابة AND');
      b.add('logicin', 0, -20);
      b.add('logicin', 0, 20);
      b.add('and', 120, 0);
      b.add('logicout', 240, 0);
      b.path(P(40, -20), P(80, -20));
      b.path(P(40, 20), P(80, 20));
      b.path(P(160, 0), P(200, 0));
      return b.done();
    },
    steps: [
      {
        ar: 'المدخلان IN1 و IN2 على 0. اضغط على IN1 لتجعله 1. هل أضاء المؤشر OUT1؟ اكتب النتيجة في جدول الحقيقة.',
        en: 'Both inputs are 0. Click IN1 to make it 1. Does OUT1 light? Note it in your truth table.',
        check: (c) => {
          const ins = c.parts('logicin').map((p) => c.num(p, 'state'));
          return ins.filter((v) => v === 1).length === 1 && (c.reading(c.parts('logicout')[0])?.extra.level ?? 1) === 0;
        },
      },
      {
        ar: 'الآن اجعل المدخلين كليهما 1. ماذا يظهر في المخرج؟',
        en: 'Now make both inputs 1. What is the output?',
        check: (c) => c.parts('logicin').every((p) => c.num(p, 'state') === 1) && c.reading(c.parts('logicout')[0])?.extra.level === 1,
      },
      {
        ar: 'بوابة AND تعطي 1 فقط عندما يكون المدخلان 1. جرّب استبدالها ببوابة OR ثم XOR وقارن جداول الحقيقة.',
        en: 'AND gives 1 only when both inputs are 1. Try OR and XOR and compare.',
      },
    ],
  },
];
