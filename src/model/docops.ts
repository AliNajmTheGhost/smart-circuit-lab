import { defOf, defaultParams, pinWorld } from './library';
import { keyOf, type CircuitDoc, type Part, type ParamValue, type Pt, type Wire } from './types';

let seq = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const cloneDoc = (d: CircuitDoc): CircuitDoc => JSON.parse(JSON.stringify(d));

/** Next free label for a type: R1, R2, ... */
export function nextLabel(doc: CircuitDoc, type: string): string {
  const prefix = defOf(type).prefix;
  const used = new Set(doc.parts.map((p) => p.label));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function makePart(doc: CircuitDoc, type: string, x: number, y: number, rot = 0, params: Record<string, ParamValue> = {}): Part {
  return { id: newId('p'), type, x, y, rot, label: nextLabel(doc, type), params: { ...defaultParams(type), ...params } };
}

/** All points where things can connect: pins and wire ends. */
function connectionPoints(doc: CircuitDoc): Pt[] {
  const map = new Map<string, Pt>();
  for (const p of doc.parts) for (let i = 0; i < defOf(p.type).pins.length; i++) {
    const w = pinWorld(p, i);
    map.set(keyOf(w), w);
  }
  for (const w of doc.wires) {
    map.set(keyOf(w.a), w.a);
    map.set(keyOf(w.b), w.b);
  }
  return [...map.values()];
}

function strictlyInside(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot > 0 && dot < len2;
}

/**
 * Keep wiring tidy after every edit:
 * a wire that passes over a pin or another wire's end is split there so they connect,
 * zero-length and duplicate wires are removed.
 */
export function normalizeWires(doc: CircuitDoc): void {
  const pts = connectionPoints(doc);
  const out: Wire[] = [];
  const seen = new Set<string>();
  for (const w of doc.wires) {
    const inner = pts.filter((p) => strictlyInside(p, w.a, w.b));
    const chain = [w.a, ...inner.sort((p, q) => dist2(w.a, p) - dist2(w.a, q)), w.b];
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      const k1 = `${keyOf(a)}|${keyOf(b)}`;
      const k2 = `${keyOf(b)}|${keyOf(a)}`;
      if (seen.has(k1) || seen.has(k2)) continue;
      seen.add(k1);
      out.push({ id: i === 0 ? w.id : newId('w'), a: { ...a }, b: { ...b } });
    }
  }
  doc.wires = out;
}

const dist2 = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (cross !== 0) return false;
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
  return dot >= 0 && dot <= dist2(a, b);
}

/**
 * Dropping a two-pin part onto a wire puts it *into* the wire:
 * the piece of wire between its pins is removed so the part is not shorted out.
 */
export function insertIntoWires(doc: CircuitDoc, part: Part): void {
  if (defOf(part.type).pins.length !== 2) return;
  const p0 = pinWorld(part, 0);
  const p1 = pinWorld(part, 1);
  const out: Wire[] = [];
  for (const w of doc.wires) {
    if (onSegment(p0, w.a, w.b) && onSegment(p1, w.a, w.b)) {
      const [near, far] = dist2(w.a, p0) <= dist2(w.a, p1) ? [p0, p1] : [p1, p0];
      out.push({ id: w.id, a: w.a, b: { ...near } }, { id: newId('w'), a: { ...far }, b: w.b });
    } else out.push(w);
  }
  doc.wires = out;
}

/** Wires from a to b: straight if aligned, otherwise an L shape. */
export function lWires(a: Pt, b: Pt, horizontalFirst?: boolean): Wire[] {
  if (a.x === b.x && a.y === b.y) return [];
  if (a.x === b.x || a.y === b.y) return [{ id: newId('w'), a: { ...a }, b: { ...b } }];
  const hFirst = horizontalFirst ?? Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const c = hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [
    { id: newId('w'), a: { ...a }, b: c },
    { id: newId('w'), a: { ...c }, b: { ...b } },
  ];
}

/**
 * A string that changes only when the circuit's wiring changes (not its values),
 * so the simulator can keep running while a student turns a knob or flips a switch.
 */
export function topologyKey(doc: CircuitDoc): string {
  const parts = doc.parts.map((p) => `${p.id}:${p.type}:${p.x}:${p.y}:${p.rot}`).join(';');
  const wires = doc.wires.map((w) => `${keyOf(w.a)}-${keyOf(w.b)}`).join(';');
  return `${parts}#${wires}`;
}

/** Small helper to build circuits in code: examples, lessons and tests. */
export class Builder {
  doc: CircuitDoc;
  constructor(title = '') {
    this.doc = { version: 1, title, parts: [], wires: [] };
  }
  add(type: string, x: number, y: number, rot = 0, params: Record<string, ParamValue> = {}): string {
    const p = makePart(this.doc, type, x, y, rot, params);
    this.doc.parts.push(p);
    return p.id;
  }
  pin(id: string, i: number): Pt {
    const p = this.doc.parts.find((q) => q.id === id);
    if (!p) throw new Error(id);
    return pinWorld(p, i);
  }
  /** A wire through the given points, in order. */
  path(...pts: Pt[]): this {
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].x === pts[i + 1].x && pts[i].y === pts[i + 1].y) continue;
      this.doc.wires.push({ id: newId('w'), a: { ...pts[i] }, b: { ...pts[i + 1] } });
    }
    return this;
  }
  /** L-shaped wire between two points. */
  wire(a: Pt, b: Pt, horizontalFirst?: boolean): this {
    this.doc.wires.push(...lWires(a, b, horizontalFirst));
    return this;
  }
  label(id: string): string {
    return this.doc.parts.find((p) => p.id === id)!.label;
  }
  done(): CircuitDoc {
    normalizeWires(this.doc);
    return this.doc;
  }
}
