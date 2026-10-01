/**
 * Repair challenges: a circuit from the examples with one hidden fault. The student reads the
 * symptom, measures, finds the faulty part and replaces it. Like the maintenance exercises
 * in the workshop, without risking real parts.
 */
import { EXAMPLES } from '../examples';
import type { Bilingual } from '../model/library';
import type { CircuitDoc, ParamValue } from '../model/types';

export type FaultKind = 'open' | 'short';

export interface Challenge extends Bilingual {
  id: string;
  grade: number;
  /** The example circuit the fault is hidden in. */
  example: string;
  /** Label of the faulty part (R1, C1...) and what is wrong with it. */
  fault: { label: string; kind: FaultKind };
  /** Values to change before the challenge starts, by part label (e.g. close the switch). */
  setup?: Record<string, Record<string, ParamValue>>;
  /** What the "customer" reports. */
  symptom: Bilingual;
  /** Shown when the student asks for help. */
  hint: Bilingual;
  /** Why the fault caused the symptom, shown after the repair. */
  explain: Bilingual;
  scopeWindow?: number;
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'lamp-open',
    grade: 1,
    ar: 'المصباح لا يضيء',
    en: 'The lamp stays dark',
    example: 'lamp',
    fault: { label: 'H1', kind: 'open' },
    setup: { S1: { closed: 1 } },
    symptom: { ar: 'المفتاح مغلق والبطارية جديدة، لكن المصباح لا يضيء.', en: 'The switch is closed and the battery is new, but the lamp stays dark.' },
    hint: { ar: 'انظر إلى الفولتميتر: هل يصل الجهد إلى المصباح؟ إذا وصل الجهد ولم يمر تيار فالعطل في المصباح نفسه.', en: 'Look at the voltmeter: does voltage reach the lamp? Voltage with no current means the lamp itself is faulty.' },
    explain: { ar: 'فتيلة المصباح مقطوعة: الجهد كامل عليه لكن لا يمر تيار، لذلك لا يضيء.', en: 'The filament was broken: full voltage across it but no current, so no light.' },
  },
  {
    id: 'led-resistor-open',
    grade: 1,
    ar: 'الثنائي الضوئي مطفأ',
    en: 'The LED is off',
    example: 'led',
    fault: { label: 'R1', kind: 'open' },
    symptom: { ar: 'الأميتر يقرأ صفراً والثنائي الضوئي لا يضيء.', en: 'The ammeter reads zero and the LED does not light.' },
    hint: { ar: 'التيار صفر يعني أن الدائرة مفتوحة في مكان ما. استعمل الأفوميتر على وضع الجهد وقس على كل قطعة: القطعة المفتوحة يظهر عليها جهد البطارية كله.', en: 'Zero current means the circuit is open somewhere. Measure the voltage across each part: the open one has the whole battery voltage across it.' },
    explain: { ar: 'المقاومة مقطوعة من الداخل فانقطع مسار التيار كله. القطعة المفتوحة يقع عليها كل جهد المصدر.', en: 'The resistor was open inside, breaking the whole current path. The open part takes the full source voltage.' },
  },
  {
    id: 'divider-short',
    grade: 1,
    ar: 'مقسم الجهد يعطي صفراً',
    en: 'The divider gives zero',
    example: 'divider',
    fault: { label: 'R2', kind: 'short' },
    symptom: { ar: 'الفولتميتر يقرأ صفراً بدل 6 فولت، والأميتر يقرأ تياراً أكبر من المتوقع.', en: 'The voltmeter reads zero instead of 6 V, and the ammeter reads more current than expected.' },
    hint: { ar: 'احسب التيار المتوقع: 9V ÷ (1kΩ + 2kΩ) = 3mA. إذا كان التيار أكبر فهناك قطعة مقصورة (موصولة بسلك من الداخل).', en: 'Expected current: 9 V ÷ 3 kΩ = 3 mA. More than that means a part is shorted inside.' },
    explain: { ar: 'المقاومة R2 مقصورة: مقاومتها صارت صفراً، فلا يقع عليها جهد ويزيد التيار.', en: 'R2 was shorted: zero resistance, so no voltage across it and more current.' },
  },
  {
    id: 'halfwave-diode-open',
    grade: 1,
    ar: 'المقوّم لا يخرج شيئاً',
    en: 'The rectifier gives nothing',
    example: 'halfwave',
    fault: { label: 'D1', kind: 'open' },
    scopeWindow: 0.05,
    symptom: { ar: 'المصدر المتناوب يعمل (القناة 1 في راسم الإشارة تظهر موجة)، لكن الخرج على القناة 2 خط مستقيم على الصفر.', en: 'The AC source works (channel 1 shows a wave) but the output on channel 2 is a flat line at zero.' },
    hint: { ar: 'الموجة تصل إلى قبل الثنائي ولا تظهر بعده. افحص الثنائي بالأفوميتر على وضع فحص الثنائي بعد فصله عن المصدر.', en: 'The wave arrives before the diode but not after it. Test the diode with the meter in diode mode.' },
    explain: { ar: 'الثنائي مفتوح: لا يمرر التيار في أي اتجاه، فلا تصل أنصاف الموجة الموجبة إلى الحمل.', en: 'The diode was open: no current either way, so no half-waves reach the load.' },
  },
  {
    id: 'transistor-base-open',
    grade: 2,
    ar: 'الترانزستور لا يشتغل',
    en: 'The transistor will not switch',
    example: 'transistor',
    fault: { label: 'R2', kind: 'open' },
    setup: { S1: { closed: 1 } },
    symptom: { ar: 'المفتاح مغلق لكن الثنائي الضوئي في دائرة الجامع لا يضيء.', en: 'The switch is closed but the LED in the collector circuit stays dark.' },
    hint: { ar: 'الترانزستور يحتاج تيار قاعدة ليشتغل. قس الجهد بين القاعدة والباعث: إذا كان أقل من 0.6V فالتيار لا يصل إلى القاعدة.', en: 'The transistor needs base current. Measure base to emitter: below 0.6 V means no current reaches the base.' },
    explain: { ar: 'مقاومة القاعدة مقطوعة، فلا يصل تيار إلى القاعدة ويبقى الترانزستور في حالة القطع.', en: 'The base resistor was open, so no base current and the transistor stayed off.' },
  },
  {
    id: '555-cap-short',
    grade: 2,
    ar: 'المؤقت 555 لا يومض',
    en: 'The 555 will not blink',
    example: '555',
    fault: { label: 'C1', kind: 'short' },
    scopeWindow: 0.2,
    symptom: { ar: 'الثنائي الضوئي مضيء باستمرار ولا يومض، والقناة 1 في راسم الإشارة على الصفر.', en: 'The LED stays on without blinking, and channel 1 of the scope sits at zero.' },
    hint: { ar: 'التذبذب يأتي من شحن المتسعة وتفريغها بين ثلث وثلثي جهد المصدر. إذا بقي جهد المتسعة صفراً فهي لا تشحن أبداً.', en: 'The 555 oscillates by charging the capacitor between one and two thirds of the supply. If its voltage stays at zero it never charges.' },
    explain: { ar: 'المتسعة مثقوبة (مقصورة): جهدها صفر دائماً، فيبقى المؤقت عالقاً والخرج ثابتاً.', en: 'The capacitor was punctured (shorted): its voltage never rises, so the timer stays stuck.' },
  },
  {
    id: 'lowpass-cap-open',
    grade: 2,
    ar: 'المرشح لا يرشّح',
    en: 'The filter does not filter',
    example: 'lowpass',
    fault: { label: 'C1', kind: 'open' },
    symptom: { ar: 'راسم بودي يظهر خطاً مستوياً على 0dB لكل الترددات، والمفروض أن يهبط بعد تردد القطع.', en: 'The Bode plotter shows a flat line at 0 dB for all frequencies; it should fall above the cut-off.' },
    hint: { ar: 'في مرشح الترددات الواطئة المتسعة هي التي تسحب الترددات العالية إلى الأرضي. إذا لم تعمل لا يتغير شيء مع التردد.', en: 'In a low-pass filter the capacitor drains the high frequencies to ground. Without it nothing depends on frequency.' },
    explain: { ar: 'المتسعة مفتوحة: كأنها غير موجودة، فتمر كل الترددات كما هي.', en: 'The capacitor was open: as if it were missing, so every frequency passes unchanged.' },
  },
  {
    id: 'ce-bypass-open',
    grade: 2,
    ar: 'المكبّر ضعيف',
    en: 'The amplifier is weak',
    example: 'ce-amp',
    fault: { label: 'C1', kind: 'open' },
    scopeWindow: 0.005,
    symptom: { ar: 'المكبّر يعمل لكن الإشارة الخارجة (القناة 2) صغيرة جداً، والكسب قريب من 4 بدل أكثر من 100.', en: 'The amplifier works but the output (channel 2) is tiny: a gain near 4 instead of over 100.' },
    hint: { ar: 'نقطة العمل سليمة (قس جهد الجامع)، لكن الكسب قليل. ما القطعة التي ترفع الكسب للإشارة المتناوبة فقط دون أن تغيّر الجهود المستمرة؟', en: 'The bias point is fine (measure the collector), but the gain is low. Which part raises the AC gain without changing DC voltages?' },
    explain: { ar: 'متسعة الإمرار على مقاومة الباعث مفتوحة، فبقيت مقاومة الباعث في طريق الإشارة وقلّلت الكسب إلى RC ÷ RE تقريباً.', en: 'The emitter bypass capacitor was open, leaving the emitter resistor in the signal path and cutting the gain to about RC ÷ RE.' },
  },
];

/** The challenge circuit: the example with its setup applied and the fault hidden inside. */
export function buildChallenge(c: Challenge): CircuitDoc {
  const ex = EXAMPLES.find((e) => e.id === c.example);
  if (!ex) throw new Error(`challenge ${c.id}: no example ${c.example}`);
  const doc = ex.build();
  doc.title = c.ar;
  for (const p of doc.parts) {
    Object.assign(p.params, c.setup?.[p.label] ?? {});
    if (p.label === c.fault.label) p.params._fault = c.fault.kind;
  }
  return doc;
}

/** Id of the faulty part in a challenge circuit. */
export function faultyPart(doc: CircuitDoc): string | undefined {
  return doc.parts.find((p) => p.params._fault === 'open' || p.params._fault === 'short')?.id;
}
