import { fmtShort } from '../units';
import { rotatePt, type ParamValue, type Part, type Pt } from './types';

export type Category = 'sources' | 'basic' | 'semis' | 'output' | 'logic' | 'ics' | 'meters';

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
  /** Only show this field when another parameter has one of these values. */
  showIf?: { key: string; values: string[] };
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
  /** Pins that may be left unconnected without a warning (e.g. 555 RESET and CTRL). */
  optional?: number[];
  /** Extra hidden nodes the simulator needs inside the part (e.g. LED + resistor per segment). */
  internalNodes?: number;
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
    type: 'psu',
    ar: 'مجهز قدرة مستمر',
    en: 'DC power supply',
    cat: 'sources',
    prefix: 'PS',
    pins: vertical(),
    params: [
      { key: 'V', ar: 'الجهد (0–30V)', en: 'Voltage (0–30 V)', unit: 'V', def: 12, min: 0, max: 30 },
      { key: 'Ilim', ar: 'حد التيار', en: 'Current limit', unit: 'A', def: 1, min: 0.001, max: 3 },
    ],
    box: { x: -26, y: -40, w: 52, h: 80 },
    labelAt: { x: 40, y: -8 },
    desc: {
      ar: 'مثل مجهز القدرة في الورشة: تضبط الجهد وحد التيار. إذا زاد الحمل يتحول إلى وضع ثبات التيار CC.',
      en: 'Set the voltage and a current limit. Overloaded, it switches to constant-current (CC) mode.',
    },
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
          { v: 'pulse', ar: 'نبضات (0 إلى القيمة العظمى)', en: 'Pulse (0 to peak)' },
          { v: 'am', ar: 'تضمين سعوي AM', en: 'AM' },
          { v: 'fm', ar: 'تضمين ترددي FM', en: 'FM' },
          { v: 'pwm', ar: 'تضمين عرض النبضة PWM', en: 'PWM' },
          { v: 'pam', ar: 'تضمين سعة النبضة PAM', en: 'PAM' },
          { v: 'ppm', ar: 'تضمين موضع النبضة PPM', en: 'PPM' },
          { v: 'ask', ar: 'إزاحة السعة ASK (بيانات)', en: 'ASK (data)' },
          { v: 'fsk', ar: 'إزاحة التردد FSK (بيانات)', en: 'FSK (data)' },
          { v: 'psk', ar: 'إزاحة الطور PSK (بيانات)', en: 'PSK (data)' },
        ],
      },
      { key: 'Vp', ar: 'السعة (القيمة العظمى)', en: 'Amplitude (peak)', unit: 'V', def: 2 },
      { key: 'f', ar: 'التردد (الحامل)', en: 'Frequency (carrier)', unit: 'Hz', def: 100, min: 0.01 },
      { key: 'duty', ar: 'نسبة التشغيل', en: 'Duty cycle', unit: '%', def: 0.5, kind: 'slider', min: 0.02, max: 0.98, step: 0.01, showIf: { key: 'wave', values: ['pulse', 'pam', 'ppm'] } },
      {
        key: 'fm',
        ar: 'تردد الإشارة المُضمِّنة / معدل البيانات',
        en: 'Modulating frequency / bit rate',
        unit: 'Hz',
        def: 100,
        min: 0.01,
        showIf: { key: 'wave', values: ['am', 'fm', 'pwm', 'pam', 'ppm', 'ask', 'fsk', 'psk'] },
      },
      { key: 'm', ar: 'معامل التضمين', en: 'Modulation index', unit: '%', def: 0.5, kind: 'slider', min: 0, max: 1, step: 0.01, showIf: { key: 'wave', values: ['am', 'pam'] } },
      { key: 'dev', ar: 'الانحراف الترددي', en: 'Frequency deviation', unit: 'Hz', def: 50, min: 0, showIf: { key: 'wave', values: ['fm', 'fsk'] } },
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
    type: 'ldr',
    ar: 'مقاومة ضوئية LDR',
    en: 'Light-dependent resistor',
    cat: 'basic',
    prefix: 'LDR',
    pins: two(),
    params: [
      { key: 'light', ar: 'شدة الضوء', en: 'Light level', unit: '%', def: 0.5, kind: 'slider', min: 0, max: 1, step: 0.01 },
      { key: 'Rdark', ar: 'المقاومة في الظلام', en: 'Dark resistance', unit: 'Ω', def: 1e6, min: 1 },
      { key: 'Rlight', ar: 'المقاومة في الضوء الكامل', en: 'Resistance in full light', unit: 'Ω', def: 500, min: 1 },
    ],
    box: { x: -40, y: -32, w: 80, h: 46 },
    labelAt: { x: 0, y: 24 },
    desc: { ar: 'تقل مقاومتها كلما زاد الضوء. حرّك شريط «شدة الضوء».', en: 'Resistance falls as light increases.' },
    valueText: (p) => `☀ ${Math.round(num(p, 'light') * 100)}%`,
  },
  {
    type: 'transformer',
    ar: 'محولة',
    en: 'Transformer',
    cat: 'basic',
    prefix: 'T',
    pins: [
      { x: -40, y: -40, ar: 'الابتدائي 1', en: 'Primary 1' },
      { x: -40, y: 40, ar: 'الابتدائي 2', en: 'Primary 2' },
      { x: 40, y: -40, ar: 'الثانوي 1', en: 'Secondary 1' },
      { x: 40, y: 40, ar: 'الثانوي 2', en: 'Secondary 2' },
    ],
    params: [
      { key: 'n', ar: 'نسبة اللفات N1:N2', en: 'Turns ratio N1:N2', unit: '', def: 10, min: 0.01 },
      { key: 'L1', ar: 'محاثة الملف الابتدائي', en: 'Primary inductance', unit: 'H', def: 10, min: 1e-6 },
    ],
    box: { x: -40, y: -46, w: 80, h: 92 },
    labelAt: { x: 0, y: -54 },
    desc: {
      ar: 'جهد الثانوي = جهد الابتدائي ÷ نسبة اللفات. تعمل على التيار المتناوب فقط.',
      en: 'Secondary voltage = primary voltage ÷ turns ratio. Works on AC only.',
    },
    valueText: (p) => `${num(p, 'n')}:1`,
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
    type: 'photodiode',
    ar: 'ثنائي حساس للضوء',
    en: 'Photodiode',
    cat: 'semis',
    prefix: 'D',
    pins: two({ ar: 'الأنود A', en: 'Anode' }, { ar: 'الكاثود K', en: 'Cathode' }),
    params: [
      { key: 'light', ar: 'شدة الضوء', en: 'Light level', unit: '%', def: 0.5, kind: 'slider', min: 0, max: 1, step: 0.01 },
      { key: 'Isc', ar: 'تيار الضوء الكامل', en: 'Full-light current', unit: 'A', def: 100e-6, min: 1e-9 },
    ],
    box: { x: -40, y: -32, w: 80, h: 46 },
    labelAt: { x: 0, y: 24 },
    desc: {
      ar: 'يوصل بانحياز عكسي، ويمر فيه تيار عكسي يزيد مع شدة الضوء.',
      en: 'Used reverse-biased; its reverse current grows with light.',
    },
    valueText: (p) => `☀ ${Math.round(num(p, 'light') * 100)}%`,
  },
  {
    type: 'scr',
    ar: 'ثايرستور SCR',
    en: 'Thyristor (SCR)',
    cat: 'semis',
    prefix: 'SCR',
    pins: [
      { x: -40, y: 0, ar: 'الأنود A', en: 'Anode' },
      { x: 40, y: 0, ar: 'الكاثود K', en: 'Cathode' },
      { x: 20, y: 40, ar: 'البوابة G', en: 'Gate' },
    ],
    params: [
      { key: 'Igt', ar: 'تيار القدح', en: 'Gate trigger current', unit: 'A', def: 0.001, min: 1e-6 },
      { key: 'Ih', ar: 'تيار المسك', en: 'Holding current', unit: 'A', def: 0.005, min: 1e-6 },
    ],
    box: { x: -40, y: -16, w: 80, h: 60 },
    labelAt: { x: 0, y: -24 },
    desc: {
      ar: 'نبضة على البوابة تجعله يوصل، ويبقى موصلاً حتى يقل التيار عن تيار المسك.',
      en: 'A gate pulse turns it on; it stays on until the current falls below the holding current.',
    },
    valueText: () => 'SCR',
  },
  {
    type: 'triac',
    ar: 'ترياك',
    en: 'Triac',
    cat: 'semis',
    prefix: 'TR',
    pins: [
      { x: -40, y: 0, ar: 'الطرف MT2', en: 'MT2' },
      { x: 40, y: 0, ar: 'الطرف MT1', en: 'MT1' },
      { x: 20, y: 40, ar: 'البوابة G', en: 'Gate' },
    ],
    params: [
      { key: 'Igt', ar: 'تيار القدح', en: 'Gate trigger current', unit: 'A', def: 0.005, min: 1e-6 },
      { key: 'Ih', ar: 'تيار المسك', en: 'Holding current', unit: 'A', def: 0.01, min: 1e-6 },
    ],
    box: { x: -40, y: -20, w: 80, h: 64 },
    labelAt: { x: 0, y: -28 },
    desc: {
      ar: 'مثل ثايرستورين متعاكسين: يوصل في الاتجاهين، ويستخدم للتحكم بالتيار المتناوب.',
      en: 'Like two opposed SCRs: conducts both ways, used to control AC.',
    },
    valueText: () => 'TRIAC',
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

  {
    type: 'sevenseg',
    ar: 'عارضة القطع السبع',
    en: '7-segment display',
    cat: 'output',
    prefix: 'DS',
    pins: [
      { x: -40, y: -60, ar: 'القطعة a', en: 'Segment a' },
      { x: -40, y: -40, ar: 'القطعة b', en: 'Segment b' },
      { x: -40, y: -20, ar: 'القطعة c', en: 'Segment c' },
      { x: -40, y: 0, ar: 'القطعة d', en: 'Segment d' },
      { x: -40, y: 20, ar: 'القطعة e', en: 'Segment e' },
      { x: -40, y: 40, ar: 'القطعة f', en: 'Segment f' },
      { x: -40, y: 60, ar: 'القطعة g', en: 'Segment g' },
      { x: 0, y: 100, ar: 'المشترك (كاثود)', en: 'Common cathode' },
    ],
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
      { key: 'Rs', ar: 'مقاومة داخلية لكل قطعة', en: 'Built-in resistor per segment', unit: 'Ω', def: 330, min: 0.001 },
    ],
    box: { x: -40, y: -74, w: 84, h: 178 },
    labelAt: { x: 0, y: -82 },
    internalNodes: 7,
    desc: {
      ar: 'سبعة ثنائيات ضوئية على شكل الرقم 8، كاثودها مشترك. لكل قطعة مقاومة داخلية.',
      en: 'Seven LEDs shaped like an 8 with a common cathode, each with a built-in resistor.',
    },
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

  // ---------- Integrated circuits ----------
  {
    type: 'timer555',
    ar: 'المؤقت 555',
    en: '555 timer',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -20, y: -80, ar: '8 · التغذية VCC', en: '8 · VCC' },
      { x: 20, y: -80, ar: '4 · إعادة الضبط RESET', en: '4 · RESET' },
      { x: -60, y: -40, ar: '7 · التفريغ DIS', en: '7 · DISCHARGE' },
      { x: -60, y: 0, ar: '6 · العتبة THR', en: '6 · THRESHOLD' },
      { x: -60, y: 40, ar: '2 · القدح TRIG', en: '2 · TRIGGER' },
      { x: 0, y: 80, ar: '1 · الأرضي GND', en: '1 · GND' },
      { x: 60, y: 0, ar: '3 · المخرج OUT', en: '3 · OUTPUT' },
      { x: 60, y: 40, ar: '5 · السيطرة CTRL', en: '5 · CONTROL' },
    ],
    params: [],
    box: { x: -60, y: -80, w: 120, h: 160 },
    labelAt: { x: 0, y: -90 },
    optional: [1, 7],
    desc: {
      ar: 'يولد نبضات. متعدد اهتزاز حر: f ≈ 1.44 ÷ ((R1 + 2R2) × C).',
      en: 'Makes pulses. Astable: f ≈ 1.44 ÷ ((R1 + 2R2) × C).',
    },
    valueText: () => 'NE555',
  },
  {
    type: 'dff',
    ar: 'قلاب D',
    en: 'D flip-flop',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -40, y: -20, ar: 'المدخل D', en: 'D' },
      { x: -40, y: 20, ar: 'نبضة الساعة CLK', en: 'Clock' },
      { x: 40, y: -20, ar: 'المخرج Q', en: 'Q' },
      { x: 40, y: 20, ar: 'المخرج المعكوس Q̄', en: 'Q̄' },
    ],
    params: [],
    box: { x: -40, y: -34, w: 80, h: 68 },
    labelAt: { x: 0, y: -42 },
    desc: { ar: 'عند صعود نبضة الساعة ينتقل D إلى Q ويبقى محفوظاً.', en: 'On a rising clock edge, Q takes the value of D.' },
  },
  {
    type: 'jkff',
    ar: 'قلاب JK',
    en: 'JK flip-flop',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -40, y: -20, ar: 'المدخل J', en: 'J' },
      { x: -40, y: 0, ar: 'نبضة الساعة CLK', en: 'Clock' },
      { x: -40, y: 20, ar: 'المدخل K', en: 'K' },
      { x: 40, y: -20, ar: 'المخرج Q', en: 'Q' },
      { x: 40, y: 20, ar: 'المخرج المعكوس Q̄', en: 'Q̄' },
    ],
    params: [],
    box: { x: -40, y: -34, w: 80, h: 68 },
    labelAt: { x: 0, y: -42 },
    desc: {
      ar: 'J=1 يضبط، K=1 يمسح، J=K=1 يقلب الحالة عند كل نبضة ساعة.',
      en: 'J sets, K resets, J=K=1 toggles on each clock edge.',
    },
  },
  {
    type: 'counter',
    ar: 'عداد عشري',
    en: 'Decade counter',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -60, y: -40, ar: 'نبضة الساعة CLK', en: 'Clock' },
      { x: -60, y: 40, ar: 'التصفير RESET', en: 'Reset' },
      { x: 60, y: -40, ar: 'المخرج QA (1)', en: 'QA (1)' },
      { x: 60, y: -20, ar: 'المخرج QB (2)', en: 'QB (2)' },
      { x: 60, y: 0, ar: 'المخرج QC (4)', en: 'QC (4)' },
      { x: 60, y: 20, ar: 'المخرج QD (8)', en: 'QD (8)' },
    ],
    params: [
      {
        key: 'mod',
        ar: 'يعد حتى',
        en: 'Counts to',
        unit: '',
        def: '10',
        kind: 'select',
        options: [
          { v: '10', ar: '9 ثم يرجع 0 (عشري)', en: '9 then 0 (decade)' },
          { v: '16', ar: '15 ثم يرجع 0 (ثنائي)', en: '15 then 0 (binary)' },
        ],
      },
    ],
    box: { x: -60, y: -54, w: 120, h: 108 },
    labelAt: { x: 0, y: -62 },
    optional: [1],
    desc: { ar: 'يزيد العدد بواحد مع كل نبضة ساعة ويخرجه بالنظام الثنائي.', en: 'Adds one on each clock pulse; outputs the count in binary.' },
    valueText: (p) => (p.mod === '16' ? '0–15' : '0–9'),
  },
  {
    type: 'bcd7',
    ar: 'مفكك BCD للقطع السبع',
    en: 'BCD to 7-segment decoder',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -60, y: -40, ar: 'المدخل A', en: 'Input A' },
      { x: -60, y: -20, ar: 'المدخل B', en: 'Input B' },
      { x: -60, y: 0, ar: 'المدخل C', en: 'Input C' },
      { x: -60, y: 20, ar: 'المدخل D', en: 'Input D' },
      { x: 60, y: -60, ar: 'المخرج a', en: 'Output a' },
      { x: 60, y: -40, ar: 'المخرج b', en: 'Output b' },
      { x: 60, y: -20, ar: 'المخرج c', en: 'Output c' },
      { x: 60, y: 0, ar: 'المخرج d', en: 'Output d' },
      { x: 60, y: 20, ar: 'المخرج e', en: 'Output e' },
      { x: 60, y: 40, ar: 'المخرج f', en: 'Output f' },
      { x: 60, y: 60, ar: 'المخرج g', en: 'Output g' },
    ],
    params: [],
    box: { x: -60, y: -74, w: 120, h: 148 },
    labelAt: { x: 0, y: -82 },
    desc: {
      ar: 'يحول الرقم الثنائي (A=1، B=2، C=4، D=8) إلى إشارات القطع السبع a إلى g.',
      en: 'Turns a binary number (A=1, B=2, C=4, D=8) into segment signals a–g.',
    },
    valueText: () => '7448',
  },

  {
    type: 'opamp',
    ar: 'مكبر العمليات',
    en: 'Operational amplifier',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -40, y: -20, ar: 'المدخل العاكس −', en: 'Inverting input −' },
      { x: -40, y: 20, ar: 'المدخل غير العاكس +', en: 'Non-inverting input +' },
      { x: 40, y: 0, ar: 'المخرج', en: 'Output' },
    ],
    params: [
      { key: 'Vsat', ar: 'جهد الإشباع (±)', en: 'Saturation voltage (±)', unit: 'V', def: 13, min: 0.5 },
      { key: 'A', ar: 'كسب الحلقة المفتوحة', en: 'Open-loop gain', unit: '', def: 100000, min: 10 },
      { key: 'GBW', ar: 'حاصل الكسب × عرض الحزمة', en: 'Gain-bandwidth product', unit: 'Hz', def: 1e6, min: 1 },
    ],
    box: { x: -40, y: -32, w: 80, h: 64 },
    labelAt: { x: 0, y: -40 },
    desc: {
      ar: 'مكبر كسبه عالٍ جداً. مع التغذية العكسية: الكسب العاكس = −Rf ÷ Rin. التغذية (±15V) مدمجة داخله.',
      en: 'Very high gain. With feedback, inverting gain = −Rf ÷ Rin. The ±15 V supply is built in.',
    },
    valueText: () => '741',
  },
  {
    type: 'adc',
    ar: 'محول تماثلي إلى رقمي A/D',
    en: 'A/D converter',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -60, y: -20, ar: 'الدخل التماثلي VIN', en: 'Analogue input' },
      { x: -60, y: 20, ar: 'نبضة أخذ العينة CLK', en: 'Sample clock' },
      { x: 60, y: -40, ar: 'المخرج D0', en: 'Output D0' },
      { x: 60, y: -20, ar: 'المخرج D1', en: 'Output D1' },
      { x: 60, y: 0, ar: 'المخرج D2', en: 'Output D2' },
      { x: 60, y: 20, ar: 'المخرج D3', en: 'Output D3' },
    ],
    params: [{ key: 'Vref', ar: 'جهد المرجع', en: 'Reference voltage', unit: 'V', def: 5, min: 0.1 }],
    box: { x: -60, y: -54, w: 120, h: 88 },
    labelAt: { x: 0, y: -62 },
    optional: [1],
    desc: {
      ar: 'يحول الجهد إلى رقم ثنائي من 4 بتات (0 إلى 15). يأخذ عينة عند كل نبضة ساعة، أو باستمرار إذا لم توصل الساعة.',
      en: 'Turns a voltage into a 4-bit number (0–15), sampled on each clock pulse or continuously without one.',
    },
    valueText: () => '4-bit',
  },
  {
    type: 'dac',
    ar: 'محول رقمي إلى تماثلي D/A',
    en: 'D/A converter',
    cat: 'ics',
    prefix: 'U',
    pins: [
      { x: -60, y: -40, ar: 'المدخل D0', en: 'Input D0' },
      { x: -60, y: -20, ar: 'المدخل D1', en: 'Input D1' },
      { x: -60, y: 0, ar: 'المدخل D2', en: 'Input D2' },
      { x: -60, y: 20, ar: 'المدخل D3', en: 'Input D3' },
      { x: 60, y: -20, ar: 'الخرج التماثلي VOUT', en: 'Analogue output' },
    ],
    params: [{ key: 'Vref', ar: 'جهد المرجع', en: 'Reference voltage', unit: 'V', def: 5, min: 0.1 }],
    box: { x: -60, y: -54, w: 120, h: 88 },
    labelAt: { x: 0, y: -62 },
    desc: {
      ar: 'يحول الرقم الثنائي (D0 إلى D3) إلى جهد: VOUT = Vref × الرقم ÷ 16.',
      en: 'Turns the binary number D0–D3 into a voltage: VOUT = Vref × code ÷ 16.',
    },
    valueText: () => '4-bit',
  },
  {
    type: 'tline',
    ar: 'خط نقل',
    en: 'Transmission line',
    cat: 'basic',
    prefix: 'TL',
    pins: [
      { x: -60, y: -20, ar: 'بداية الخط +', en: 'Sending end +' },
      { x: -60, y: 20, ar: 'بداية الخط − (الأرضي)', en: 'Sending end − (return)' },
      { x: 60, y: -20, ar: 'نهاية الخط +', en: 'Receiving end +' },
      { x: 60, y: 20, ar: 'نهاية الخط − (الأرضي)', en: 'Receiving end − (return)' },
    ],
    params: [
      { key: 'Z0', ar: 'الممانعة المميزة Z0', en: 'Characteristic impedance Z0', unit: 'Ω', def: 75, min: 1 },
      { key: 'Td', ar: 'زمن انتقال الإشارة', en: 'Delay', unit: 's', def: 100e-6, min: 1e-7 },
      { key: 'loss', ar: 'الاضمحلال', en: 'Attenuation', unit: 'dB', def: 0, min: 0 },
    ],
    box: { x: -60, y: -30, w: 120, h: 60 },
    labelAt: { x: 0, y: -38 },
    desc: {
      ar: 'تصل الإشارة إلى النهاية بعد زمن الانتقال. إذا لم يساوِ الحمل Z0 ترتد الإشارة: الخط المفتوح يعكسها كما هي والقصر يعكسها مقلوبة.',
      en: 'Signals arrive after the delay. A load unequal to Z0 reflects them: open ends reflect as-is, shorts invert.',
    },
    valueText: (p) => `${fmtShort(num(p, 'Z0'), 'Ω')} ${fmtShort(num(p, 'Td'), 's')}`,
  },

  // ---------- Meters ----------
  {
    type: 'multimeter',
    ar: 'أفوميتر رقمي',
    en: 'Digital multimeter',
    cat: 'meters',
    prefix: 'XMM',
    pins: [
      { x: 20, y: 60, ar: 'الطرف الأحمر (V Ω A)', en: 'Red lead (V Ω A)' },
      { x: -20, y: 60, ar: 'الطرف الأسود COM', en: 'Black lead COM' },
    ],
    params: [
      {
        key: 'mode',
        ar: 'مفتاح الاختيار',
        en: 'Selector',
        unit: '',
        def: 'vdc',
        kind: 'select',
        options: [
          { v: 'vdc', ar: 'فولت مستمر V⎓', en: 'DC volts V⎓' },
          { v: 'vac', ar: 'فولت متناوب V~', en: 'AC volts V~' },
          { v: 'adc', ar: 'أمبير مستمر A⎓', en: 'DC amps A⎓' },
          { v: 'aac', ar: 'أمبير متناوب A~', en: 'AC amps A~' },
          { v: 'ohm', ar: 'أوم Ω (افصل المصدر أولاً)', en: 'Ohms Ω (power off first)' },
          { v: 'diode', ar: 'فحص الثنائي ▶|', en: 'Diode test ▶|' },
        ],
      },
    ],
    box: { x: -32, y: -46, w: 64, h: 106 },
    labelAt: { x: 0, y: -54 },
    readoutAt: { x: 0, y: -26 },
    desc: {
      ar: 'جهاز القياس المتعدد: يقيس الجهد والتيار والمقاومة ويفحص الثنائي. غيّر وضعه من «مفتاح الاختيار».',
      en: 'Measures volts, amps and ohms and tests diodes. Change the selector to switch.',
    },
  },
  {
    type: 'bode',
    ar: 'راسم بودي',
    en: 'Bode plotter',
    cat: 'meters',
    prefix: 'XBP',
    pins: [
      { x: -20, y: 40, ar: 'الدخل IN', en: 'Input' },
      { x: 20, y: 40, ar: 'الخرج OUT', en: 'Output' },
    ],
    params: [
      { key: 'fmin', ar: 'أقل تردد', en: 'Start frequency', unit: 'Hz', def: 1, min: 0.001 },
      { key: 'fmax', ar: 'أعلى تردد', en: 'End frequency', unit: 'Hz', def: 100000, min: 0.01 },
    ],
    box: { x: -36, y: -30, w: 72, h: 74 },
    labelAt: { x: 0, y: -38 },
    desc: {
      ar: 'يرسم استجابة الدائرة للتردد (الكسب والطور) ويحسب تردد القطع. يحتاج مولد إشارة أو مصدراً متناوباً في الدائرة.',
      en: 'Plots gain and phase against frequency and finds the cut-off. Needs a signal source in the circuit.',
    },
  },
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
  { id: 'ics', ar: 'الدوائر المتكاملة', en: 'Integrated circuits' },
  { id: 'meters', ar: 'أجهزة القياس', en: 'Instruments' },
];

export const isGate = (type: string): boolean => ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'].includes(type);

export function pinWorld(part: Part, i: number): Pt {
  const pin = defOf(part.type).pins[i];
  const r = rotatePt(pin, part.rot);
  return { x: part.x + r.x, y: part.y + r.y };
}

