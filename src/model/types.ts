/** A point on the board, in board pixels. Everything snaps to GRID. */
export interface Pt {
  x: number;
  y: number;
}

export type ParamValue = number | string;

/** One component placed on the board. */
export interface Part {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Quarter turns clockwise: 0..3 */
  rot: number;
  /** Mirrored top to bottom before turning (a transistor with its emitter on top). */
  flip?: boolean;
  label: string;
  params: Record<string, ParamValue>;
}

/** A straight wire segment. Wires connect wherever their ends meet a pin or another wire end. */
export interface Wire {
  id: string;
  a: Pt;
  b: Pt;
}

/** The whole circuit, as saved in a .nabd file. */
export interface CircuitDoc {
  version: 1;
  title: string;
  parts: Part[];
  wires: Wire[];
}

export const GRID = 20;

export const keyOf = (p: Pt): string => `${p.x},${p.y}`;

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

/** Rotate a local point by quarter turns clockwise (screen coordinates, y down). */
export function rotatePt(p: Pt, rot: number): Pt {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return { x: -p.y, y: p.x };
    case 2:
      return { x: -p.x, y: -p.y };
    case 3:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/** Place a local point of a part: mirror it first when the part is flipped, then turn it. */
export function orientPt(p: Pt, rot: number, flip?: boolean): Pt {
  return rotatePt(flip ? { x: p.x, y: -p.y } : p, rot);
}

export function emptyDoc(title = ''): CircuitDoc {
  return { version: 1, title, parts: [], wires: [] };
}
