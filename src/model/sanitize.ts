/**
 * Circuit files arrive from outside the program: a classmate's USB stick, a download, a chat
 * message. Nothing inside one is trusted. Every document is rebuilt here from the part
 * definitions — numbers must really be numbers, drop-down values must be ones the part offers,
 * and identifiers are issued fresh — so a hand-written file can only describe a circuit and
 * never reach the interface as markup or break the simulation core.
 */
import { PART_BY_TYPE, coerceParam, defaultParams } from './library';
import { newId } from './docops';
import type { CircuitDoc, ParamValue, Part, Pt, Wire } from './types';

/** The board is far smaller than this; the limit only keeps coordinates finite and sane. */
const COORD_LIMIT = 1e6;
const MAX_TITLE = 120;
const MAX_LABEL = 40;
/** A circuit a student can draw is far below this; it stops a file from hanging the program. */
const MAX_PARTS = 5000;
const MAX_WIRES = 20000;

/** The hidden parameter repair challenges use to break a part. */
const FAULTS = ['open', 'short'];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  // Control characters have no place in a label or a title and would only confuse the display.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : null;
}

function coord(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > COORD_LIMIT) return null;
  return v;
}

function point(v: unknown): Pt | null {
  if (!isObject(v)) return null;
  const x = coord(v.x);
  const y = coord(v.y);
  return x === null || y === null ? null : { x, y };
}

/** One parameter, checked against its own definition: numbers stay in range, lists stay on the list. */
function param(def: { def: ParamValue; options?: { v: string }[]; min?: number; max?: number }, raw: unknown): ParamValue | null {
  if (typeof def.def === 'number') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return null;
    if (def.min !== undefined && n < def.min) return def.min;
    if (def.max !== undefined && n > def.max) return def.max;
    return n;
  }
  // Every text parameter in the library is a drop-down, so only its own options are accepted.
  const s = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : null;
  if (s === null || !def.options?.some((o) => o.v === s)) return null;
  return coerceParam(def as never, s);
}

function part(raw: unknown): Part | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  const def = PART_BY_TYPE.get(raw.type);
  if (!def) return null;
  const x = coord(raw.x);
  const y = coord(raw.y);
  if (x === null || y === null) return null;

  const params = defaultParams(def.type);
  const given = isObject(raw.params) ? raw.params : {};
  for (const d of def.params) {
    const v = param(d, given[d.key]);
    if (v !== null) params[d.key] = v;
  }
  // Repair challenges hide the fault in the file; no other extra parameter is carried over.
  if (typeof given._fault === 'string' && FAULTS.includes(given._fault)) params._fault = given._fault;

  return {
    // Identifiers from the file are never reused: they end up in the page as attributes.
    id: newId('p'),
    type: def.type,
    x,
    y,
    rot: Number.isFinite(raw.rot as number) ? ((((raw.rot as number) | 0) % 4) + 4) % 4 : 0,
    label: text(raw.label, MAX_LABEL) ?? def.prefix,
    params,
  };
}

function wire(raw: unknown): Wire | null {
  if (!isObject(raw)) return null;
  const a = point(raw.a);
  const b = point(raw.b);
  return a && b ? { id: newId('w'), a, b } : null;
}

export interface Sanitized {
  doc: CircuitDoc;
  /** How many parts and wires the file described that this version could not use. */
  dropped: number;
}

/**
 * Turn the contents of a circuit file into a document the rest of the program can trust,
 * or null if it is not a circuit at all. Parts and wires that do not make sense are dropped
 * rather than failing the whole file, so a circuit saved by a newer version still opens —
 * and `dropped` says how many were left behind, so the student is told rather than handed a
 * circuit that quietly lost a wire.
 */
export function sanitizeDoc(raw: unknown): Sanitized | null {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.parts) || !Array.isArray(raw.wires)) return null;
  if (raw.parts.length > MAX_PARTS || raw.wires.length > MAX_WIRES) return null;

  const parts: Part[] = [];
  for (const p of raw.parts) {
    const q = part(p);
    if (q) parts.push(q);
  }
  // A file whose parts were all rejected is not a circuit this version can open.
  if (parts.length === 0 && raw.parts.length > 0) return null;

  const wires: Wire[] = [];
  for (const w of raw.wires) {
    const q = wire(w);
    if (q) wires.push(q);
  }

  const doc: CircuitDoc = { version: 1, title: text(raw.title, MAX_TITLE) ?? '', parts, wires };
  return { doc, dropped: raw.parts.length - parts.length + (raw.wires.length - wires.length) };
}
