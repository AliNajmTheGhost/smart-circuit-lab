import { fmtShort } from '../units';
import { rotatePt, type ParamValue, type Part, type Pt } from './types';

export type Category = 'sources' | 'basic' | 'semis' | 'output' | 'logic' | 'meters';

export interface Bilingual {
  ar: string;
  en: string;
}

export interface ParamDef extends Bilingual {
  key: string;
  unit: string;
  def: ParamValue;
  kind?: 'number' | 'select' | 'slider';
  options?: ({ v: string } & Bilingual)[];
  min?: number;
  max?: number;
  step?: number;
}

export interface PinDef extends Bilingual {
  x: number;
  y: number;
}

export interface PartDef extends Bilingual {
  type: string;
  cat: Category;
  /** Label prefix: R -> R1, R2 ... */
  prefix: string;
  pins: PinDef[];
  params: ParamDef[];
  /** Local box used for selection and hit testing. */
  box: { x: number; y: number; w: number; h: number };
  /** Where the label sits, in local coordinates (it is rotated with the part but drawn upright). */
  labelAt: Pt | null;
  /** Where a live reading is drawn (meters, logic probes). */
  readoutAt?: Pt;
  /** toggle: a click flips it. momentary: closed only while pressed. */
  interactive?: 'toggle' | 'momentary';
  desc: Bilingual;
  /** Short value shown under the label on the board. */
  valueText?: (p: Record<string, ParamValue>) => string;
}

export const LED_COLORS: Record<string, { vf: number; hex: string } & Bilingual> = {
  red: { vf: 1.8, hex: '#ff3b30', ar: 'أحمر', en: 'Red' },
  green: { vf: 2.1, hex: '#22c55e', ar: 'أخضر', en: 'Green' },
  yellow: { vf: 2.0, hex: '#facc15', ar: 'أصفر', en: 'Yellow' },
  blue: { vf: 3.0, hex: '#3b82f6', ar: 'أزرق', en: 'Blue' },
  white: { vf: 3.0, hex: '#e8eef2', ar: 'أبيض', en: 'White' },
};

const num = (p: Record<string, ParamValue>, k: string): number => Number(p[k]);

const H2 = { x: -40, y: -14, w: 80, h: 28 };
const two = (a: Bilingual = { ar: 'طرف 1', en: 'Pin 1' }, b: Bilingual = { ar: 'طرف 2', en: 'Pin 2' }): PinDef[] => [
  { x: -40, y: 0, ...a },
  { x: 40, y: 0, ...b },
];
const PLUS = { ar: 'الموجب +', en: 'Positive +' };
const MINUS = { ar: 'السالب −', en: 'Negative −' };
const vertical = (): PinDef[] => [
  { x: 0, y: -40, ...PLUS },
  { x: 0, y: 40, ...MINUS },
];
const TRANSISTOR_BOX = { x: -40, y: -40, w: 72, h: 80 };
const bjtPins = (): PinDef[] => [
  { x: -40, y: 0, ar: 'القاعدة B', en: 'Base B' },
  { x: 20, y: -40, ar: 'الجامع C', en: 'Collector C' },
  { x: 20, y: 40, ar: 'الباعث E', en: 'Emitter E' },
];
const fetPins = (): PinDef[] => [
  { x: -40, y: 0, ar: 'البوابة G', en: 'Gate G' },
  { x: 20, y: -40, ar: 'المصرف D', en: 'Drain D' },
  { x: 20, y: 40, ar: 'المصدر S', en: 'Source S' },
];
const gate2Pins = (): PinDef[] => [
  { x: -40, y: -20, ar: 'المدخل A', en: 'Input A' },
  { x: -40, y: 20, ar: 'المدخل B', en: 'Input B' },
  { x: 40, y: 0, ar: 'المخرج', en: 'Output' },
];
const GATE_BOX = { x: -40, y: -30, w: 80, h: 60 };
const METER_MODE: ParamDef = {
  key: 'mode',
  ar: 'نوع القياس',
  en: 'Mode',
  unit: '',
  def: 'dc',
  kind: 'select',
  options: [
    { v: 'dc', ar: 'مستمر DC', en: 'DC' },
    { v: 'ac', ar: 'متناوب AC (فعّال)', en: 'AC (RMS)' },
  ],
};

const gate = (type: string, ar: string, en: string, desc: string, descEn: string): PartDef => ({
  type,
  ar,
  en,
  cat: 'logic',
  prefix: 'U',
  pins: type === 'not' ? [{ x: -40, y: 0, ar: 'المدخل', en: 'Input' }, { x: 40, y: 0, ar: 'المخرج', en: 'Output' }] : gate2Pins(),
  params: [],
  box: GATE_BOX,
  labelAt: { x: 0, y: -40 },
  desc: { ar: desc, en: descEn },
});

export const PARTS: PartDef[] = [
  // ---------- Sources ----------
  {
    type: 'battery',
    ar: 'بطارية',
    en: 'Battery',
    cat: 'sources',
    prefix: 'V',
    pins: vertical(),
    params: [
      { key: 'V', ar: 'الجهد', en: 'Voltage', unit: 'V', def: 9 },
      { key: 'r', ar: 'المقاومة الداخلية', en: 'Internal resistance', unit: 'Ω', def: 0.1, min: 0.001 },
    ],
    box: { x: -18, y: -40, w: 36, h: 80 },
    labelAt: { x: 34, y: -8 },
    desc: { ar: 'مصدر جهد مستمر. الخط الطويل هو القطب الموجب.', en: 'DC voltage source. The long plate is positive.' },
    valueText: (p) => fmtShort(num(p, 'V'), 'V'),
  },
  {
    type: 'ac',
    ar: 'مصدر متناوب',
    en: 'AC source',
    cat: 'sources',
    prefix: 'V',
    pins: vertical(),
    params: [
      { key: 'Vp', ar: 'القيمة العظمى', en: 'Peak voltage', unit: 'V', def: 12 },
      { key: 'f', ar: 'التردد', en: 'Frequency', unit: 'Hz', def: 50, min: 0.01 },
      { key: 'r', ar: 'المقاومة الداخلية', en: 'Internal resistance', unit: 'Ω', def: 0.1, min: 0.001 },
    ],
    box: { x: -20, y: -40, w: 40, h: 80 },
    labelAt: { x: 36, y: -8 },
    desc: { ar: 'جهد جيبي يتغير مع الزمن مثل كهرباء البيت.', en: 'Sine wave voltage, like mains power.' },
    valueText: (p) => `${fmtShort(num(p, 'Vp'), 'V')} ${fmtShort(num(p, 'f'), 'Hz')}`,
  },
  {
    type: 'funcgen',
    ar: 'مولد الإشارة',
    en: 'Function generator',
    cat: 'sources',
    prefix: 'XFG',
    pins: [
      { x: 0, y: -40, ar: 'المخرج +', en: 'Output +' },
      { x: 0, y: 40, ar: 'المشترك COM', en: 'Common' },
    ],
    params: [
      {
        key: 'wave',
        ar: 'شكل الموجة',
        en: 'Waveform',
        unit: '',
        def: 'sine',
        kind: 'select',
        options: [
          { v: 'sine', ar: 'جيبية', en: 'Sine' },
          { v: 'square', ar: 'مربعة', en: 'Square' },
          { v: 'triangle', ar: 'مثلثية', en: 'Triangle' },
        ],
      },
      { key: 'Vp', ar: 'السعة (القيمة العظمى)', en: 'Amplitude (peak)', unit: 'V', def: 2 },
      { key: 'f', ar: 'التردد', en: 'Frequency', unit: 'Hz', def: 100, min: 0.01 },
      { key: 'offset', ar: 'الإزاحة المستمرة', en: 'DC offset', unit: 'V', def: 0 },
      { key: 'r', ar: 'مقاومة المخرج', en: 'Output resistance', unit: 'Ω', def: 50, min: 0.001 },
    ],
    box: { x: -24, y: -40, w: 48, h: 80 },
    labelAt: { x: 40, y: -8 },
    desc: { ar: 'يولد موجة جيبية أو مربعة أو مثلثية بالتردد الذي تختاره.', en: 'Sine, square or triangle wave at any frequency.' },
    valueText: (p) => `${fmtShort(num(p, 'Vp'), 'V')} ${fmtShort(num(p, 'f'), 'Hz')}`,
  },
  {
    type: 'ground',
    ar: 'أرضي',
    en: 'Ground',
    cat: 'sources',
    prefix: 'GND',
    pins: [{ x: 0, y: 0, ar: 'الأرضي', en: 'Ground' }],
    params: [],
    box: { x: -16, y: -4, w: 32, h: 28 },
    labelAt: null,
    desc: { ar: 'نقطة الصفر. كل الجهود تقاس بالنسبة لها.', en: 'The 0 V reference point.' },
  },

  // ---------- Basic ----------
  {
    type: 'resistor',
    ar: 'مقاومة',
    en: 'Resistor',
    cat: 'basic',
    prefix: 'R',
    pins: two(),
    params: [
      { key: 'R', ar: 'المقاومة', en: 'Resistance', unit: 'Ω', def: 1000, min: 0.001 },
      { key: 'Pmax', ar: 'أقصى قدرة', en: 'Power rating', unit: 'W', def: 0.25, min: 0.001 },
    ],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'تحد من مرور التيار. V = I × R', en: 'Limits current. V = I × R' },
    valueText: (p) => fmtShort(num(p, 'R'), 'Ω'),
  },
  {
    type: 'pot',
    ar: 'مقاومة متغيرة',
    en: 'Potentiometer',
    cat: 'basic',
    prefix: 'RV',
    pins: [
      { x: -40, y: 0, ar: 'الطرف A', en: 'End A' },
      { x: 40, y: 0, ar: 'الطرف B', en: 'End B' },
      { x: 0, y: -40, ar: 'المنزلق', en: 'Wiper' },
    ],
    params: [
      { key: 'R', ar: 'المقاومة الكلية', en: 'Total resistance', unit: 'Ω', def: 10000, min: 1 },
      { key: 'pos', ar: 'موضع المنزلق', en: 'Wiper position', unit: '%', def: 0.5, kind: 'slider', min: 0, max: 1, step: 0.01 },
    ],
    box: { x: -40, y: -40, w: 80, h: 54 },
    labelAt: { x: 0, y: 26 },
    desc: { ar: 'حرّك المنزلق لتغيير المقاومة بين الأطراف.', en: 'Move the wiper to change resistance.' },
    valueText: (p) => fmtShort(num(p, 'R'), 'Ω'),
  },
  {
    type: 'capacitor',
    ar: 'متسعة',
    en: 'Capacitor',
    cat: 'basic',
    prefix: 'C',
    pins: two(),
    params: [
      { key: 'C', ar: 'السعة', en: 'Capacitance', unit: 'F', def: 10e-6, min: 1e-12 },
      { key: 'Vmax', ar: 'أقصى جهد', en: 'Voltage rating', unit: 'V', def: 50, min: 0.1 },
    ],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'تخزن الشحنة. تشحن وتفرغ عبر المقاومة.', en: 'Stores charge.' },
    valueText: (p) => fmtShort(num(p, 'C'), 'F'),
  },
  {
    type: 'ecap',
    ar: 'متسعة كيميائية',
    en: 'Electrolytic capacitor',
    cat: 'basic',
    prefix: 'C',
    pins: two(PLUS, MINUS),
    params: [
      { key: 'C', ar: 'السعة', en: 'Capacitance', unit: 'F', def: 100e-6, min: 1e-9 },
      { key: 'Vmax', ar: 'أقصى جهد', en: 'Voltage rating', unit: 'V', def: 25, min: 0.1 },
    ],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'متسعة لها قطبية. توصيلها بالعكس يتلفها.', en: 'Polarised. Reversing it destroys it.' },
    valueText: (p) => fmtShort(num(p, 'C'), 'F'),
  },
  {
    type: 'inductor',
    ar: 'ملف',
    en: 'Inductor',
    cat: 'basic',
    prefix: 'L',
    pins: two(),
    params: [
      { key: 'L', ar: 'المحاثة', en: 'Inductance', unit: 'H', def: 0.01, min: 1e-9 },
      { key: 'Rs', ar: 'مقاومة السلك', en: 'Wire resistance', unit: 'Ω', def: 1, min: 0.001 },
    ],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'يقاوم التغير في التيار.', en: 'Opposes changes in current.' },
    valueText: (p) => fmtShort(num(p, 'L'), 'H'),
  },
  {
    type: 'switch',
    ar: 'مفتاح',
    en: 'Switch',
    cat: 'basic',
    prefix: 'S',
    pins: two(),
    params: [
      {
        key: 'closed',
        ar: 'الحالة',
        en: 'State',
        unit: '',
        def: 0,
        kind: 'select',
        options: [
          { v: '0', ar: 'مفتوح', en: 'Open' },
          { v: '1', ar: 'مغلق', en: 'Closed' },
        ],
      },
    ],
    box: { x: -40, y: -20, w: 80, h: 30 },
    labelAt: { x: 0, y: -28 },
    interactive: 'toggle',
    desc: { ar: 'اضغط عليه لفتحه أو غلقه.', en: 'Click to open or close it.' },
  },
  {
    type: 'button',
    ar: 'زر ضاغط',
    en: 'Push button',
    cat: 'basic',
    prefix: 'S',
    pins: two(),
    params: [],
    box: { x: -40, y: -26, w: 80, h: 34 },
    labelAt: { x: 0, y: -34 },
    interactive: 'momentary',
    desc: { ar: 'يغلق الدائرة ما دمت ضاغطاً عليه.', en: 'Closed only while pressed.' },
  },
  {
    type: 'fuse',
    ar: 'مصهر',
    en: 'Fuse',
    cat: 'basic',
    prefix: 'F',
    pins: two(),
    params: [{ key: 'I', ar: 'تيار الانصهار', en: 'Rating', unit: 'A', def: 1, min: 0.001 }],
    box: H2,
    labelAt: { x: 0, y: -22 },
    desc: { ar: 'ينصهر ويفتح الدائرة إذا زاد التيار عن قيمته.', en: 'Blows when current exceeds its rating.' },
    valueText: (p) => fmtShort(num(p, 'I'), 'A'),
  },

  // ---------- Semiconductors ----------
  {
    type: 'diode',
    ar: 'ثنائي',
    en: 'Diode',
    cat: 'semis',
    prefix: 'D',
    pins: two({ ar: 'الأنود A', en: 'Anode' }, { ar: 'الكاثود K', en: 'Cathode' }),
    params: [{ key: 'Imax', ar: 'أقصى تيار', en: 'Max current', unit: 'A', def: 1, min: 0.001 }],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'يمرر التيار في اتجاه واحد فقط (من الأنود إلى الكاثود).', en: 'Conducts one way only.' },
    valueText: () => '1N4007',
  },
  {
    type: 'zener',
    ar: 'ثنائي زينر',
    en: 'Zener diode',
    cat: 'semis',
    prefix: 'DZ',
    pins: two({ ar: 'الأنود A', en: 'Anode' }, { ar: 'الكاثود K', en: 'Cathode' }),
    params: [
      { key: 'Vz', ar: 'جهد زينر', en: 'Zener voltage', unit: 'V', def: 5.1, min: 0.5 },
      { key: 'Pmax', ar: 'أقصى قدرة', en: 'Power rating', unit: 'W', def: 0.5, min: 0.01 },
    ],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'يوصل بالعكس ليثبت الجهد عند قيمة زينر.', en: 'Used reversed to hold a fixed voltage.' },
    valueText: (p) => fmtShort(num(p, 'Vz'), 'V'),
  },
  {
    type: 'schottky',
    ar: 'ثنائي شوتكي',
    en: 'Schottky diode',
    cat: 'semis',
    prefix: 'D',
    pins: two({ ar: 'الأنود A', en: 'Anode' }, { ar: 'الكاثود K', en: 'Cathode' }),
    params: [{ key: 'Imax', ar: 'أقصى تيار', en: 'Max current', unit: 'A', def: 1, min: 0.001 }],
    box: H2,
    labelAt: { x: 0, y: -24 },
    desc: { ar: 'ثنائي سريع هبوط الجهد عليه صغير (حوالي 0.3V).', en: 'Low forward drop (about 0.3 V).' },
  },
  {
    type: 'led',
    ar: 'ثنائي باعث للضوء',
    en: 'LED',
    cat: 'semis',
    prefix: 'LED',
    pins: two({ ar: 'الأنود A (الساق الطويلة)', en: 'Anode (long leg)' }, { ar: 'الكاثود K', en: 'Cathode' }),
    params: [
      {
        key: 'color',
        ar: 'اللون',
        en: 'Colour',
        unit: '',
        def: 'red',
        kind: 'select',
        options: Object.entries(LED_COLORS).map(([v, c]) => ({ v, ar: c.ar, en: c.en })),
      },
      { key: 'Imax', ar: 'التيار المقنن', en: 'Rated current', unit: 'A', def: 0.02, min: 0.001 },
    ],
    box: { x: -40, y: -26, w: 80, h: 40 },
    labelAt: { x: 0, y: -32 },
    desc: { ar: 'يضيء عندما يمر فيه تيار. يحتاج مقاومة على التوالي.', en: 'Lights up with current. Needs a series resistor.' },
    valueText: (p) => LED_COLORS[String(p.color)]?.ar ?? '',
  },
  {
    type: 'npn',
    ar: 'ترانزستور NPN',
    en: 'NPN transistor',
    cat: 'semis',
    prefix: 'Q',
    pins: bjtPins(),
    params: [
      { key: 'beta', ar: 'معامل التكبير β', en: 'Gain β', unit: '', def: 100, min: 1 },
      { key: 'Pmax', ar: 'أقصى قدرة', en: 'Power rating', unit: 'W', def: 0.5, min: 0.01 },
    ],
    box: TRANSISTOR_BOX,
    labelAt: { x: 46, y: -8 },
    desc: { ar: 'تيار صغير في القاعدة يتحكم بتيار كبير في الجامع.', en: 'A small base current controls a large collector current.' },
    valueText: () => 'NPN',
  },
  {
    type: 'pnp',
    ar: 'ترانزستور PNP',
    en: 'PNP transistor',
    cat: 'semis',
    prefix: 'Q',
    pins: bjtPins(),
    params: [
      { key: 'beta', ar: 'معامل التكبير β', en: 'Gain β', unit: '', def: 100, min: 1 },
      { key: 'Pmax', ar: 'أقصى قدرة', en: 'Power rating', unit: 'W', def: 0.5, min: 0.01 },
    ],
    box: TRANSISTOR_BOX,
    labelAt: { x: 46, y: -8 },
    desc: { ar: 'مثل NPN لكن التيارات والجهود معكوسة.', en: 'Like NPN with reversed polarities.' },
    valueText: () => 'PNP',
  },
  {
    type: 'nmos',
    ar: 'ترانزستور موسفت N',
    en: 'N-channel MOSFET',
    cat: 'semis',
    prefix: 'Q',
    pins: fetPins(),
    params: [
      { key: 'Vth', ar: 'جهد العتبة', en: 'Threshold voltage', unit: 'V', def: 2, min: 0.1 },
      { key: 'K', ar: 'معامل التوصيل K', en: 'Transconductance K', unit: 'A/V²', def: 0.1, min: 1e-6 },
    ],
    box: TRANSISTOR_BOX,
    labelAt: { x: 46, y: -8 },
    desc: { ar: 'يتحكم به جهد البوابة، ولا تسحب البوابة تياراً.', en: 'Controlled by gate voltage; the gate draws no current.' },
    valueText: () => 'N-MOS',
  },
  {
    type: 'pmos',
    ar: 'ترانزستور موسفت P',
    en: 'P-channel MOSFET',
    cat: 'semis',
    prefix: 'Q',
    pins: fetPins(),
    params: [
      { key: 'Vth', ar: 'جهد العتبة', en: 'Threshold voltage', unit: 'V', def: 2, min: 0.1 },
      { key: 'K', ar: 'معامل التوصيل K', en: 'Transconductance K', unit: 'A/V²', def: 0.1, min: 1e-6 },
    ],
    box: TRANSISTOR_BOX,
    labelAt: { x: 46, y: -8 },
    desc: { ar: 'يعمل عندما يكون جهد البوابة أقل من المصدر.', en: 'Turns on when the gate is below the source.' },
    valueText: () => 'P-MOS',
  },

  // ---------- Output ----------
  {
    type: 'lamp',
    ar: 'مصباح',
    en: 'Lamp',
    cat: 'output',
    prefix: 'H',
    pins: two(),
    params: [
      { key: 'V', ar: 'الجهد المقنن', en: 'Rated voltage', unit: 'V', def: 12, min: 0.1 },
      { key: 'P', ar: 'القدرة المقننة', en: 'Rated power', unit: 'W', def: 5, min: 0.01 },
    ],
    box: { x: -40, y: -20, w: 80, h: 40 },
    labelAt: { x: 0, y: -28 },
    desc: { ar: 'يضيء أكثر كلما زادت القدرة. يحترق إذا زاد الجهد كثيراً.', en: 'Brighter with more power; burns out when overdriven.' },
    valueText: (p) => `${fmtShort(num(p, 'V'), 'V')} ${fmtShort(num(p, 'P'), 'W')}`,
  },

  // ---------- Logic ----------
  gate('and', 'بوابة AND', 'AND gate', 'المخرج 1 فقط إذا كان المدخلان 1.', 'Output is 1 only when both inputs are 1.'),
  gate('or', 'بوابة OR', 'OR gate', 'المخرج 1 إذا كان أي مدخل 1.', 'Output is 1 when any input is 1.'),
  gate('not', 'بوابة NOT', 'NOT gate', 'تعكس المدخل: 1 تصبح 0.', 'Inverts the input.'),
  gate('nand', 'بوابة NAND', 'NAND gate', 'عكس AND.', 'Inverted AND.'),
  gate('nor', 'بوابة NOR', 'NOR gate', 'عكس OR.', 'Inverted OR.'),
  gate('xor', 'بوابة XOR', 'XOR gate', 'المخرج 1 إذا اختلف المدخلان.', 'Output is 1 when the inputs differ.'),
  gate('xnor', 'بوابة XNOR', 'XNOR gate', 'المخرج 1 إذا تساوى المدخلان.', 'Output is 1 when the inputs match.'),
  {
    type: 'logicin',
    ar: 'مدخل منطقي',
    en: 'Logic input',
    cat: 'logic',
    prefix: 'IN',
    pins: [{ x: 40, y: 0, ar: 'المخرج', en: 'Output' }],
    params: [
      {
        key: 'state',
        ar: 'الحالة',
        en: 'State',
        unit: '',
        def: 0,
        kind: 'select',
        options: [
          { v: '0', ar: '0 (منخفض)', en: '0 (low)' },
          { v: '1', ar: '1 (عالٍ 5V)', en: '1 (high 5 V)' },
        ],
      },
    ],
    box: { x: -20, y: -18, w: 60, h: 36 },
    labelAt: { x: 0, y: -28 },
    readoutAt: { x: 0, y: 0 },
    interactive: 'toggle',
    desc: { ar: 'اضغط عليه للتبديل بين 0 و 1.', en: 'Click to switch between 0 and 1.' },
  },
  {
    type: 'logicout',
    ar: 'مؤشر منطقي',
    en: 'Logic probe',
    cat: 'logic',
    prefix: 'OUT',
    pins: [{ x: -40, y: 0, ar: 'المدخل', en: 'Input' }],
    params: [],
    box: { x: -40, y: -18, w: 58, h: 36 },
    labelAt: { x: 0, y: -28 },
    readoutAt: { x: 0, y: 0 },
    desc: { ar: 'يضيء ويظهر 1 عندما يكون المدخل عالياً.', en: 'Shows 1 when its input is high.' },
  },

  // ---------- Meters ----------
  {
    type: 'voltmeter',
    ar: 'فولتميتر',
    en: 'Voltmeter',
    cat: 'meters',
    prefix: 'VM',
    pins: two(PLUS, MINUS),
    params: [METER_MODE],
    box: { x: -40, y: -20, w: 80, h: 40 },
    labelAt: { x: 0, y: -28 },
    readoutAt: { x: 0, y: 34 },
    desc: { ar: 'يقيس الجهد. يوصل على التوازي مع القطعة.', en: 'Measures voltage. Connect in parallel.' },
  },
  {
    type: 'ammeter',
    ar: 'أميتر',
    en: 'Ammeter',
    cat: 'meters',
    prefix: 'AM',
    pins: two(PLUS, MINUS),
    params: [METER_MODE],
    box: { x: -40, y: -20, w: 80, h: 40 },
    labelAt: { x: 0, y: -28 },
    readoutAt: { x: 0, y: 34 },
    desc: { ar: 'يقيس التيار. يوصل على التوالي مع القطعة.', en: 'Measures current. Connect in series.' },
  },
  {
    type: 'probe',
    ar: 'مجس راسم الإشارة',
    en: 'Scope probe',
    cat: 'meters',
    prefix: 'P',
    pins: [{ x: 0, y: 0, ar: 'المجس', en: 'Probe' }],
    params: [
      {
        key: 'ch',
        ar: 'القناة',
        en: 'Channel',
        unit: '',
        def: '1',
        kind: 'select',
        options: [
          { v: '1', ar: 'القناة 1', en: 'Channel 1' },
          { v: '2', ar: 'القناة 2', en: 'Channel 2' },
        ],
      },
    ],
    box: { x: -16, y: -46, w: 32, h: 50 },
    labelAt: null,
    desc: { ar: 'ضعه على أي نقطة لترى شكل الجهد عليها في راسم الإشارة.', en: 'Place on a point to see its voltage on the scope.' },
  },
];

export const PART_BY_TYPE = new Map(PARTS.map((d) => [d.type, d]));

export function defOf(type: string): PartDef {
  const d = PART_BY_TYPE.get(type);
  if (!d) throw new Error(`Unknown part type: ${type}`);
  return d;
}

export function defaultParams(type: string): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of defOf(type).params) out[p.key] = p.def;
  return out;
}

export const CATEGORIES: ({ id: Category } & Bilingual)[] = [
  { id: 'sources', ar: 'المصادر', en: 'Sources' },
  { id: 'basic', ar: 'القطع الأساسية', en: 'Basic' },
  { id: 'semis', ar: 'أشباه الموصلات', en: 'Semiconductors' },
  { id: 'output', ar: 'الإخراج', en: 'Output' },
  { id: 'logic', ar: 'البوابات المنطقية', en: 'Logic' },
  { id: 'meters', ar: 'أجهزة القياس', en: 'Instruments' },
];

export const isGate = (type: string): boolean => ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'].includes(type);

export function pinWorld(part: Part, i: number): Pt {
  const pin = defOf(part.type).pins[i];
  const r = rotatePt(pin, part.rot);
  return { x: part.x + r.x, y: part.y + r.y };
}

