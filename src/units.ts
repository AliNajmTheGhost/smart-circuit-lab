const PREFIX: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

/**
 * Read a value the way students write it: "4.7k", "4k7", "100uF", "100µ", "10mH", "5V",
 * with Arabic-Indic digits and the Arabic decimal comma accepted too.
 * Returns null when the text is not a number.
 */
export function parseValue(input: string): number | null {
  let s = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[٫,]/g, '.')
    .replace(/\s+/g, '');
  if (s === '') return null;
  s = s.replace(/(ohm|Ω|hz|v|a|f|h|w|s)$/i, '');
  const meg = s.match(/^(.*)meg$/i);
  if (meg) s = meg[1] + 'M';

  let m = s.match(/^([+-]?\d+)([pnuµμmkKMG])(\d+)$/);
  if (m) return parseFloat(`${m[1]}.${m[3]}`) * PREFIX[m[2]];

  m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([pnuµμmkKMG])?$/);
  if (!m) return null;
  const v = parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] : 1);
  return Number.isFinite(v) ? v : null;
}

const STEPS: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Engineering notation with a prefix: 0.0047 A -> "4.7 mA". */
export function fmt(v: number, unit = '', digits = 3, space = true): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sep = space ? ' ' : '';
  if (a < 1e-12) return `0${sep}${unit}`.trim();
  for (const [f, p] of STEPS) {
    if (a >= f * 0.9995 || f === 1e-12) {
      let s = (v / f).toPrecision(digits);
      if (s.includes('.')) s = s.replace(/\.?0+$/, '');
      return `${s}${sep}${p}${unit}`;
    }
  }
  return `${v}${sep}${unit}`;
}

/** Compact form for labels on the board: "4.7kΩ". */
export const fmtShort = (v: number, unit = ''): string => fmt(v, unit, 3, false);

export interface Prefix {
  sym: string;
  factor: number;
  ar: string;
  en: string;
}

const P_ALL: Record<string, Prefix> = {
  G: { sym: 'G', factor: 1e9, ar: 'كيكا', en: 'giga' },
  M: { sym: 'M', factor: 1e6, ar: 'ميكا', en: 'mega' },
  k: { sym: 'k', factor: 1e3, ar: 'كيلو', en: 'kilo' },
  '': { sym: '', factor: 1, ar: '', en: '' },
  m: { sym: 'm', factor: 1e-3, ar: 'ميلي', en: 'milli' },
  µ: { sym: 'µ', factor: 1e-6, ar: 'مايكرو', en: 'micro' },
  n: { sym: 'n', factor: 1e-9, ar: 'نانو', en: 'nano' },
  p: { sym: 'p', factor: 1e-12, ar: 'بيكو', en: 'pico' },
};

/** Which prefixes make sense for each unit, largest first (what a student would pick from). */
const BY_UNIT: Record<string, string[]> = {
  Ω: ['M', 'k', '', 'm'],
  F: ['', 'm', 'µ', 'n', 'p'],
  H: ['', 'm', 'µ'],
  V: ['k', '', 'm', 'µ'],
  A: ['', 'm', 'µ', 'n'],
  W: ['k', '', 'm'],
  Hz: ['G', 'M', 'k', ''],
  s: ['', 'm', 'µ', 'n'],
};

/** Prefixes offered in a unit's drop-down, or none for unitless values. */
export function prefixesFor(unit: string): Prefix[] {
  return (BY_UNIT[unit] ?? []).map((k) => P_ALL[k]);
}

/** Split a value into the number a student types and the prefix they pick: 4700 Ω -> 4.7 and k. */
export function splitValue(v: number, unit: string): { num: number; prefix: Prefix } {
  const list = prefixesFor(unit);
  if (!list.length || v === 0 || !Number.isFinite(v)) return { num: v, prefix: P_ALL[''] };
  const a = Math.abs(v);
  // The largest prefix that keeps the number at 1 or more; otherwise the smallest available.
  const pick = list.find((p) => a >= p.factor * 0.9999) ?? list[list.length - 1];
  return { num: Number((v / pick.factor).toPrecision(6)), prefix: pick };
}
