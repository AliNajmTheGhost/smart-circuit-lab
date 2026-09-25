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
  /** True while the oscilloscope / Bode panel is open. */
  scopeOpen: boolean;
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
const extra = (c: LessonCtx, type: string, key: string) => {
  const p = c.parts(type)[0];
  return p ? (c.reading(p)?.extra[key] ?? NaN) : NaN;
};
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!;
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
    scopeOpen: app.scopeOpen,
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
  {
    id: 'ohmmeter',
    grade: 1,
    ref: '7–9',
    ar: 'قياس المقاومة بالأفوميتر',
    en: 'Measuring resistance',
    goal: { ar: 'قراءة المقاومة المكافئة لمقاومتين على التوالي، ومعرفة وضع فحص الثنائي.', en: 'Read series resistance and try the diode-test position.' },
    build: () => example('ohmmeter').build(),
    steps: [
      {
        ar: 'الأفوميتر على وضع الأوم وموصول على طرفي المقاومتين R1 و R2 الموصولتين على التوالي. اقرأ الشاشة: هل تساوي R1 + R2 = 1k + 2.2k = 3.2kΩ؟',
        en: 'The meter is on ohms across R1 and R2 in series. Does it read 1k + 2.2k = 3.2 kΩ?',
        check: (c) => near(extra(c, 'multimeter', 'reading'), 3200, 60),
      },
      {
        ar: 'غيّر R2 إلى 4.7k. احسب المجموع في دفترك أولاً، ثم تحقق من الشاشة.',
        en: 'Change R2 to 4.7k. Work out the total first, then check the display.',
        check: (c) => near(extra(c, 'multimeter', 'reading'), 5700, 100),
      },
      {
        ar: 'تذكّر: لا تقس المقاومة والدائرة موصولة بالمصدر. الآن حوّل «مفتاح الاختيار» إلى «فحص الثنائي». تظهر OL لأن المقاومات لا توصل مثل الثنائي.',
        en: 'Never measure ohms on a powered circuit. Now switch to diode test: it shows OL for resistors.',
        check: (c) => c.parts('multimeter').some((m) => m.params.mode === 'diode'),
      },
    ],
  },
  {
    id: 'transformer',
    grade: 1,
    ref: '17',
    ar: 'المحولة الكهربائية',
    en: 'The transformer',
    goal: { ar: 'التحقق من أن جهد الثانوي = جهد الابتدائي ÷ نسبة اللفات.', en: 'Check that secondary voltage = primary ÷ turns ratio.' },
    build: () => example('transformer').build(),
    steps: [
      {
        ar: 'المصدر 220V فعّال ونسبة اللفات 18.3:1. الأفوميتر على وضع V~ على الثانوي. هل يقرأ 220 ÷ 18.3 ≈ 12V؟',
        en: 'Mains 220 V RMS, ratio 18.3:1. Does the meter (V~) read 220 ÷ 18.3 ≈ 12 V?',
        check: (c) => near(extra(c, 'multimeter', 'reading'), 12, 1),
      },
      {
        ar: 'غيّر نسبة اللفات في المحولة T1 إلى 9.2. كم يصبح جهد الثانوي؟ وماذا يحدث للمصباح المصمم لـ 12V؟',
        en: 'Change T1’s ratio to 9.2. What is the secondary voltage now, and what happens to the 12 V lamp?',
        check: (c) => c.parts('transformer').some((t) => near(c.num(t, 'n'), 9.2, 0.05)) && extra(c, 'multimeter', 'reading') > 20,
      },
      {
        ar: 'الجهد تضاعف إلى حوالي 24V فاحترق المصباح. لذلك نختار نسبة اللفات حسب الجهد الذي يحتاجه الحمل.',
        en: 'About 24 V burned the lamp. Choose the ratio for the voltage the load needs.',
      },
    ],
  },
  {
    id: '555',
    grade: 2,
    ref: '14',
    ar: 'المؤقت 555: متعدد الاهتزاز الحر',
    en: '555 astable multivibrator',
    goal: { ar: 'مشاهدة شحن المتسعة ونبضات المخرج، وتغيير التردد.', en: 'Watch the capacitor and output pulses, then change the frequency.' },
    scopeWindow: 0.2,
    build: () => example('555').build(),
    steps: [
      {
        ar: 'افتح «راسم الإشارة». القناة 1 تظهر جهد المتسعة يصعد وينزل بين ثلث وثلثي جهد التغذية (3V و 6V)، والقناة 2 تظهر النبضات على المخرج التي تومض الثنائي.',
        en: 'Open the oscilloscope. CH1 shows the capacitor between 1/3 and 2/3 of the supply; CH2 shows the output pulses.',
        check: (c) => c.scopeOpen,
      },
      {
        ar: 'التردد ≈ 1.44 ÷ ((R1 + 2×R2) × C) ≈ 15Hz. غيّر المتسعة C1 إلى 2.2µ. هل أصبح الوميض أبطأ؟',
        en: 'f ≈ 1.44 ÷ ((R1 + 2R2) × C) ≈ 15 Hz. Change C1 to 2.2µ. Is the blinking slower?',
        check: (c) => c.parts('capacitor').some((x) => near(c.num(x, 'C'), 2.2e-6, 1e-8)),
      },
      {
        ar: 'زيادة السعة تزيد زمن الشحن فيقل التردد. جرّب أيضاً تغيير R2.',
        en: 'More capacitance means longer charging and a lower frequency. Try changing R2 too.',
      },
    ],
  },
  {
    id: 'counter',
    grade: 2,
    ref: '32',
    ar: 'العداد وعارضة القطع السبع',
    en: 'Counter and 7-segment display',
    goal: { ar: 'فهم العد الثنائي وتحويله إلى رقم على العارضة.', en: 'Understand binary counting and decoding to a digit.' },
    build: () => example('counter').build(),
    steps: [
      {
        ar: 'كل نبضة من مولد الإشارة تزيد العداد واحداً، والمفكك يحول الرقم الثنائي إلى القطع السبع. انتظر حتى يظهر الرقم 5.',
        en: 'Each clock pulse adds one; the decoder turns the binary number into segments. Wait for 5.',
        check: (c) => extra(c, 'counter', 'count') >= 5,
      },
      {
        ar: 'المخارج QA=1 و QB=2 و QC=4 و QD=8. الرقم 5 = 1 + 4، أي QA و QC. اختر العداد U1 وغيّر «يعد حتى» إلى الوضع الثنائي 15. ماذا يظهر على العارضة بعد 9؟',
        en: 'QA=1, QB=2, QC=4, QD=8, so 5 = QA + QC. Switch the counter to binary (15). What shows after 9?',
        check: (c) => c.parts('counter').some((x) => x.params.mod === '16'),
      },
      {
        ar: 'المفكك 7448 لا يعرض الأرقام من 10 إلى 15، لذلك تنطفئ العارضة. لهذا نستخدم العداد العشري مع العارضة.',
        en: 'The decoder cannot show 10–15, so the display goes blank. That is why decade counters are used.',
      },
    ],
  },
  {
    id: 'lowpass',
    grade: 3,
    ref: '6',
    ar: 'مرشح إمرار الترددات الواطئة',
    en: 'Low-pass filter',
    goal: { ar: 'رسم استجابة المرشح للتردد وإيجاد تردد القطع.', en: 'Plot the frequency response and find the cut-off.' },
    scopeWindow: 0.002,
    build: () => example('lowpass').build(),
    steps: [
      {
        ar: 'افتح «راسم الإشارة» واختر تبويب «راسم بودي». المنحني الأصفر هو الكسب: ثابت في الترددات الواطئة ثم يهبط بعد تردد القطع fc = 1 ÷ (2π×R×C) ≈ 1.59kHz.',
        en: 'Open the panel and pick the Bode tab. Gain is flat, then falls after fc = 1 ÷ (2πRC) ≈ 1.59 kHz.',
        check: (c) => c.scopeOpen,
      },
      {
        ar: 'غيّر المتسعة C1 إلى 10n. أين أصبح تردد القطع؟ احسبه ثم قارنه بالرقم الظاهر.',
        en: 'Change C1 to 10n. Where is the cut-off now? Calculate it, then compare.',
        check: (c) => c.parts('capacitor').some((x) => near(c.num(x, 'C'), 1e-8, 1e-11)),
      },
      {
        ar: 'ارجع إلى تبويب «راسم الإشارة» وغيّر تردد مولد الإشارة إلى 100k: لاحظ أن الإشارة الخارجة (القناة 2) صغرت كثيراً.',
        en: 'Back on the oscilloscope, set the generator to 100k: the output (CH2) becomes much smaller.',
      },
    ],
  },
];
