import { t } from '../i18n';
import { insertIntoWires, lWires, makePart, newId } from '../model/docops';
import { defOf, pinWorld } from '../model/library';
import { GRID, keyOf, rotatePt, snap, type CircuitDoc, type Part, type Pt } from '../model/types';
import { fmt } from '../units';
import type { App } from './app';
import { symbolSvg } from './symbols';

const NS = 'http://www.w3.org/2000/svg';

interface PartRefs {
  glows: SVGElement[];
  heat: SVGElement | null;
  readout: SVGTextElement | null;
  lin: SVGElement | null;
  lout: SVGElement | null;
  segs: SVGElement[];
  flows: { el: SVGLineElement; pin: number; sign: number }[];
}

interface WireRefs {
  line: SVGLineElement;
  flow: SVGLineElement;
}

type Drag =
  | {
      kind: 'group';
      /** The part under the pointer, used for switch clicks. */
      clicked: string | null;
      parts: string[];
      wires: string[];
      start: Pt;
      origParts: Map<string, Pt>;
      origWires: Map<string, { a: Pt; b: Pt }>;
      attach: Attach[];
      moved: boolean;
      lastDx: number;
      lastDy: number;
      snapshot: string;
      pointer: number;
    }
  | { kind: 'box'; start: Pt; cur: Pt; add: boolean; pointer: number }
  | { kind: 'wire'; from: Pt; moved: boolean; onWire: boolean; pointer: number }
  | { kind: 'pan'; start: Pt; orig: Pt; pointer: number }
  | { kind: 'pinch'; dist: number; zoom: number; mid: Pt; pan: Pt };

interface Attach {
  part: string;
  wire: string;
  end: 'a' | 'b';
  pin: number;
}

const escapeXml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().replace('#', '');
  const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: [number, number, number], b: [number, number, number], k: number): string =>
  `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;

/** Where a pin or wire end attaches to a part, so wires follow when it moves or turns. */
function attachments(doc: CircuitDoc, part: Part): Attach[] {
  const out: Attach[] = [];
  const n = defOf(part.type).pins.length;
  for (let i = 0; i < n; i++) {
    const k = keyOf(pinWorld(part, i));
    for (const w of doc.wires) {
      if (keyOf(w.a) === k) out.push({ part: part.id, wire: w.id, end: 'a', pin: i });
      if (keyOf(w.b) === k) out.push({ part: part.id, wire: w.id, end: 'b', pin: i });
    }
  }
  return out;
}

function followPins(doc: CircuitDoc, part: Part, attach: Attach[]): void {
  for (const a of attach) {
    const w = doc.wires.find((x) => x.id === a.wire);
    if (w) w[a.end] = pinWorld(part, a.pin);
  }
}

export class Board {
  readonly svg: SVGSVGElement;
  private vp: SVGGElement;
  private gWires: SVGGElement;
  private gParts: SVGGElement;
  private gFlows: SVGGElement;
  private gOver: SVGGElement;
  private gGhost: SVGGElement;
  private hint: HTMLElement;
  pan: Pt = { x: 0, y: 0 };
  zoom = 1;
  private partRefs = new Map<string, PartRefs>();
  private wireRefs = new Map<string, WireRefs>();
  private offsets = new WeakMap<SVGElement, number>();
  private pointers = new Map<number, Pt>();
  private drag: Drag | null = null;
  private pendingWire: Pt | null = null;
  private hover: Pt | null = null;
  private hoverWorld: Pt = { x: 0, y: 0 };
  private neutral: [number, number, number] = [120, 130, 140];
  private lastFrame = 0;

  constructor(
    private app: App,
    host: HTMLElement,
  ) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('board');
    this.svg.setAttribute('dir', 'ltr');
    this.svg.innerHTML = `
      <defs>
        <pattern id="grid" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">
          <circle cx="0" cy="0" r="1.1" class="griddot"/>
        </pattern>
        <filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <rect class="gridbg" x="0" y="0" width="100%" height="100%" fill="url(#grid)"/>
      <g class="vp"><g class="wires"></g><g class="parts"></g><g class="flows"></g><g class="over"></g><g class="ghost"></g></g>`;
    host.appendChild(this.svg);
    this.vp = this.svg.querySelector('.vp')!;
    this.gWires = this.svg.querySelector('.wires')!;
    this.gParts = this.svg.querySelector('.parts')!;
    this.gFlows = this.svg.querySelector('.flows')!;
    this.gOver = this.svg.querySelector('.over')!;
    this.gGhost = this.svg.querySelector('.ghost')!;
    this.hint = document.createElement('div');
    this.hint.className = 'board-hint';
    this.hint.hidden = true;
    host.appendChild(this.hint);

    this.readTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readTheme());

    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.up(e, true));
    this.svg.addEventListener('pointerleave', () => {
      this.hover = null;
      this.drawOverlay();
    });
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());

    app.on('doc', () => this.render());
    app.on('select', () => this.render());
    app.on('mode', () => {
      this.pendingWire = null;
      this.updateHint();
      this.drawGhost();
    });
    app.on('frame', () => this.frame());
    app.on('settings', () => this.frame());
  }

  private readTheme(): void {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--wire').trim();
    if (v.startsWith('#')) this.neutral = hexToRgb(v);
  }

  // ------------------------------------------------------------ coordinates

  private applyView(): void {
    this.vp.setAttribute('transform', `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`);
    const pat = this.svg.querySelector('#grid')!;
    pat.setAttribute('patternTransform', `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`);
  }

  private screen(e: { clientX: number; clientY: number }): Pt {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private world(e: { clientX: number; clientY: number }): Pt {
    const s = this.screen(e);
    return { x: (s.x - this.pan.x) / this.zoom, y: (s.y - this.pan.y) / this.zoom };
  }

  setZoom(z: number, about?: Pt): void {
    const r = this.svg.getBoundingClientRect();
    const c = about ?? { x: r.width / 2, y: r.height / 2 };
    const nz = Math.min(3, Math.max(0.3, z));
    const wx = (c.x - this.pan.x) / this.zoom;
    const wy = (c.y - this.pan.y) / this.zoom;
    this.zoom = nz;
    this.pan = { x: c.x - wx * nz, y: c.y - wy * nz };
    this.applyView();
  }

  /** Zoom and pan so the whole circuit is visible. */
  fit(): void {
    const d = this.app.doc;
    const r = this.svg.getBoundingClientRect();
    if (d.parts.length === 0 || r.width === 0) {
      this.zoom = 1;
      this.pan = { x: r.width / 2, y: r.height / 2 };
      this.applyView();
      return;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (p: Pt) => {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    };
    for (const p of d.parts) {
      const b = this.partBox(p);
      grow({ x: b.x, y: b.y });
      grow({ x: b.x + b.w, y: b.y + b.h });
    }
    for (const w of d.wires) {
      grow(w.a);
      grow(w.b);
    }
    const pad = 90;
    const z = Math.min(1.6, Math.max(0.3, Math.min(r.width / (x1 - x0 + pad * 2), r.height / (y1 - y0 + pad * 2))));
    this.zoom = z;
    this.pan = { x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2) * z };
    this.applyView();
  }

  private partBox(p: Part): { x: number; y: number; w: number; h: number } {
    const b = defOf(p.type).box;
    const c = [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ].map((q) => rotatePt(q, p.rot));
    const x = Math.min(c[0].x, c[1].x);
    const y = Math.min(c[0].y, c[1].y);
    return { x: p.x + x, y: p.y + y, w: Math.abs(c[1].x - c[0].x), h: Math.abs(c[1].y - c[0].y) };
  }

  // ------------------------------------------------------------ hit testing

  /** Nearest pin or wire end within reach of the pointer. */
  private connectable(w: Pt, touch: boolean): Pt | null {
    const reach = (touch ? 20 : 11) / this.zoom;
    let best: Pt | null = null;
    let bd = reach * reach;
    const test = (p: Pt) => {
      const d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2;
      if (d <= bd) {
        bd = d;
        best = p;
      }
    };
    for (const p of this.app.doc.parts) for (let i = 0; i < defOf(p.type).pins.length; i++) test(pinWorld(p, i));
    for (const x of this.app.doc.wires) {
      test(x.a);
      test(x.b);
    }
    return best;
  }

  // ------------------------------------------------------------ pointer input

  private down(e: PointerEvent): void {
    try {
      this.svg.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointers cannot be captured */
    }
    this.pointers.set(e.pointerId, this.screen(e));
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.cancelDrag();
      this.drag = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, pan: { ...this.pan } };
      return;
    }
    const w = this.world(e);
    const s = { x: snap(w.x), y: snap(w.y) };
    const touch = e.pointerType === 'touch';
    const app = this.app;

    if (app.placing) {
      const type = app.placing;
      let id = '';
      app.commit((d) => {
        const p = makePart(d, type, s.x, s.y);
        d.parts.push(p);
        insertIntoWires(d, p);
        id = p.id;
      });
      app.startPlacing(null);
      app.select({ kind: 'part', id });
      return;
    }

    if (this.pendingWire) {
      const end = this.connectable(w, touch) ?? s;
      this.addWire(this.pendingWire, end);
      this.pendingWire = null;
      this.updateHint();
      this.drawOverlay();
      return;
    }

    const pin = this.connectable(w, touch);
    const target = e.target as Element;
    const partEl = target.closest('.part') as SVGGElement | null;
    const wireEl = target.closest('.wire') as SVGGElement | null;

    if (pin && !(partEl && defOf(app.part(partEl.dataset.id!)!.type).interactive && !this.nearPinOnly(pin, w))) {
      this.drag = { kind: 'wire', from: pin, moved: false, onWire: false, pointer: e.pointerId };
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (partEl) {
      const id = partEl.dataset.id!;
      const part = app.part(id)!;
      if (additive) {
        app.toggleSelected('part', id);
        return;
      }
      if (!app.isSelected('part', id)) app.select({ kind: 'part', id });
      this.startGroupDrag(w, id, e.pointerId);
      if (defOf(part.type).interactive === 'momentary') app.setParam(id, 'closed', 1, false);
      return;
    }
    if (wireEl) {
      const id = wireEl.dataset.id!;
      if (additive) {
        app.toggleSelected('wire', id);
        return;
      }
      if (app.isSelected('wire', id) && app.selCount > 1) {
        this.startGroupDrag(w, null, e.pointerId);
        return;
      }
      app.select({ kind: 'wire', id });
      this.drag = { kind: 'wire', from: s, moved: false, onWire: true, pointer: e.pointerId };
      return;
    }
    // Empty board: the mouse draws a selection box; touch, right and middle buttons pan.
    if (!touch && e.button === 0) {
      if (!additive) app.select(null);
      this.drag = { kind: 'box', start: w, cur: w, add: additive, pointer: e.pointerId };
      return;
    }
    this.drag = { kind: 'pan', start: this.screen(e), orig: { ...this.pan }, pointer: e.pointerId };
  }

  /** Drag everything that is selected; wires attached to moving parts stretch to follow. */
  private startGroupDrag(w: Pt, clicked: string | null, pointer: number): void {
    const app = this.app;
    const parts = [...app.sel.parts].map((id) => app.part(id)).filter((p): p is Part => !!p);
    const wires = app.doc.wires.filter((x) => app.sel.wires.has(x.id));
    const attach = parts.flatMap((p) => attachments(app.doc, p)).filter((a) => !app.sel.wires.has(a.wire));
    this.drag = {
      kind: 'group',
      clicked,
      parts: parts.map((p) => p.id),
      wires: wires.map((x) => x.id),
      start: w,
      origParts: new Map(parts.map((p) => [p.id, { x: p.x, y: p.y }])),
      origWires: new Map(wires.map((x) => [x.id, { a: { ...x.a }, b: { ...x.b } }])),
      attach,
      moved: false,
      lastDx: 0,
      lastDy: 0,
      snapshot: JSON.stringify(app.doc),
      pointer,
    };
  }

  /** On switches the whole body toggles; only start a wire when the pointer is really on the pin. */
  private nearPinOnly(pin: Pt, w: Pt): boolean {
    return (pin.x - w.x) ** 2 + (pin.y - w.y) ** 2 < (6 / this.zoom) ** 2;
  }

  private move(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.screen(e));
    const w = this.world(e);
    this.hoverWorld = w;
    const d = this.drag;

    if (d?.kind === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.pan = d.pan;
      this.zoom = d.zoom;
      this.setZoom(d.zoom * (dist / d.dist), d.mid);
      return;
    }
    if (d?.kind === 'pan') {
      const s = this.screen(e);
      this.pan = { x: d.orig.x + s.x - d.start.x, y: d.orig.y + s.y - d.start.y };
      this.applyView();
      return;
    }
    if (d?.kind === 'group') {
      const dx = snap(w.x - d.start.x);
      const dy = snap(w.y - d.start.y);
      if (dx === d.lastDx && dy === d.lastDy) return;
      d.lastDx = dx;
      d.lastDy = dy;
      d.moved = dx !== 0 || dy !== 0 || d.moved;
      const doc = this.app.doc;
      for (const id of d.parts) {
        const p = this.app.part(id);
        const op = d.origParts.get(id)!;
        if (p) {
          p.x = op.x + dx;
          p.y = op.y + dy;
        }
      }
      for (const x of doc.wires) {
        const ow = d.origWires.get(x.id);
        if (!ow) continue;
        x.a = { x: ow.a.x + dx, y: ow.a.y + dy };
        x.b = { x: ow.b.x + dx, y: ow.b.y + dy };
      }
      for (const a of d.attach) {
        const p = this.app.part(a.part);
        const x = doc.wires.find((q) => q.id === a.wire);
        if (p && x) x[a.end] = pinWorld(p, a.pin);
      }
      this.render();
      return;
    }
    if (d?.kind === 'box') {
      d.cur = w;
      this.drawOverlay();
      return;
    }
    if (d?.kind === 'wire') {
      const s = { x: snap(w.x), y: snap(w.y) };
      if (s.x !== d.from.x || s.y !== d.from.y) d.moved = true;
    }
    this.hover = this.app.placing ? null : this.connectable(w, e.pointerType === 'touch');
    this.drawOverlay();
    this.drawGhost();
  }

  private up(e: PointerEvent, cancelled = false): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size < 2) this.drag = null;
      return;
    }
    if (d.pointer !== e.pointerId) return;
    this.drag = null;
    const app = this.app;
    if (d.kind === 'group') {
      const part = d.clicked ? app.part(d.clicked) : undefined;
      const def = part ? defOf(part.type) : undefined;
      if (part && def?.interactive === 'momentary') app.setParam(part.id, 'closed', 0, false);
      if (d.moved) {
        const moved = JSON.stringify(app.doc);
        app.doc = JSON.parse(d.snapshot);
        app.commit((doc) => {
          Object.assign(doc, JSON.parse(moved));
          if (d.parts.length === 1 && d.wires.length === 0) {
            const p = doc.parts.find((q) => q.id === d.parts[0]);
            if (p) insertIntoWires(doc, p);
          }
        });
      } else if (!cancelled && part && def?.interactive === 'toggle') {
        const key = part.type === 'logicin' ? 'state' : 'closed';
        app.setParam(part.id, key, Number(part.params[key]) === 1 ? 0 : 1, false);
      } else if (!cancelled && part && app.selCount > 1) {
        // A plain click on one item of a group selects just that item.
        app.select({ kind: 'part', id: part.id });
      }
      return;
    }
    if (d.kind === 'box') {
      this.finishBox(d);
      this.drawOverlay();
      return;
    }
    if (d.kind === 'wire' && !cancelled) {
      const w = this.world(e);
      const end = this.connectable(w, e.pointerType === 'touch') ?? { x: snap(w.x), y: snap(w.y) };
      if (d.moved && (end.x !== d.from.x || end.y !== d.from.y)) {
        this.addWire(d.from, end);
      } else if (!d.onWire) {
        this.pendingWire = d.from;
        this.updateHint();
      }
      this.drawOverlay();
    }
  }

  private finishBox(d: { start: Pt; cur: Pt; add: boolean }): void {
    const x0 = Math.min(d.start.x, d.cur.x);
    const x1 = Math.max(d.start.x, d.cur.x);
    const y0 = Math.min(d.start.y, d.cur.y);
    const y1 = Math.max(d.start.y, d.cur.y);
    if (x1 - x0 < 4 / this.zoom && y1 - y0 < 4 / this.zoom) return;
    const inside = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const parts = this.app.doc.parts
      .filter((p) => {
        const b = this.partBox(p);
        return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
      })
      .map((p) => p.id);
    const wires = this.app.doc.wires.filter((w) => inside(w.a) && inside(w.b)).map((w) => w.id);
    this.app.selectMany(parts, wires, d.add);
  }

  private cancelDrag(): void {
    const d = this.drag;
    if (d?.kind === 'group' && d.moved) {
      this.app.doc = JSON.parse(d.snapshot);
      this.render();
    }
    this.drag = null;
  }

  private addWire(a: Pt, b: Pt): void {
    const wires = lWires(a, b);
    if (wires.length) this.app.commit((d) => d.wires.push(...wires));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), this.screen(e));
  }

  /** Esc: stop placing or drawing. */
  cancel(): boolean {
    if (this.pendingWire) {
      this.pendingWire = null;
      this.updateHint();
      this.drawOverlay();
      return true;
    }
    if (this.app.placing) {
      this.app.startPlacing(null);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ editing commands

  rotateSelected(): void {
    const s = this.app.selection;
    if (s?.kind !== 'part') return;
    this.app.commit((d) => {
      const p = d.parts.find((q) => q.id === s.id);
      if (!p) return;
      const att = attachments(d, p);
      p.rot = (p.rot + 1) % 4;
      followPins(d, p, att);
    });
  }

  deleteSelected(): void {
    const app = this.app;
    if (!app.selCount) return;
    const parts = new Set(app.sel.parts);
    const wires = new Set(app.sel.wires);
    app.commit((d) => {
      d.parts = d.parts.filter((p) => !parts.has(p.id));
      d.wires = d.wires.filter((w) => !wires.has(w.id));
    });
    app.select(null);
  }

  /** Copy the selection (parts and the wires between them) two grid squares down and across. */
  duplicateSelected(): void {
    const app = this.app;
    if (!app.selCount) return;
    const off = 2 * GRID;
    const srcParts = app.doc.parts.filter((p) => app.sel.parts.has(p.id));
    const srcWires = app.doc.wires.filter((w) => app.sel.wires.has(w.id));
    const newParts: string[] = [];
    const newWires: string[] = [];
    app.commit((d) => {
      for (const src of srcParts) {
        const p = makePart(d, src.type, src.x + off, src.y + off, src.rot, { ...src.params });
        d.parts.push(p);
        newParts.push(p.id);
      }
      for (const w of srcWires) {
        const id = newId('w');
        d.wires.push({ id, a: { x: w.a.x + off, y: w.a.y + off }, b: { x: w.b.x + off, y: w.b.y + off } });
        newWires.push(id);
      }
    });
    app.selectMany(newParts, newWires);
  }

  // ------------------------------------------------------------ drawing

  private updateHint(): void {
    const app = this.app;
    if (app.placing) {
      this.hint.textContent = t('placing', { name: app.placing ? defName(app.placing) : '' });
      this.hint.hidden = false;
    } else if (this.pendingWire) {
      this.hint.textContent = t('wiring');
      this.hint.hidden = false;
    } else this.hint.hidden = true;
  }

  render(): void {
    this.applyView();
    const app = this.app;
    const std = app.std;

    this.gWires.innerHTML = app.doc.wires
      .map((w) => {
        const cls = app.isSelected('wire', w.id) ? ' selected' : '';
        const xy = `x1="${w.a.x}" y1="${w.a.y}" x2="${w.b.x}" y2="${w.b.y}"`;
        return `<g class="wire${cls}" data-id="${w.id}"><line class="hit" ${xy}/><line class="w" ${xy}/><line class="flow" ${xy}/></g>`;
      })
      .join('');

    const flows: string[] = [];
    this.gParts.innerHTML = app.doc.parts
      .map((p) => {
        const def = defOf(p.type);
        const b = def.box;
        const broken = app.broken.has(p.id);
        const cls = `part type-${p.type}${app.isSelected('part', p.id) ? ' selected' : ''}${broken ? ' broken' : ''}${def.interactive ? ' interactive' : ''}`;
        let label = '';
        if (def.labelAt) {
          // Upside-down parts keep their label on top, and upright ones always on the right.
          const o = rotatePt(def.labelAt, p.rot % 2);
          const side = Math.abs(o.x) > Math.abs(o.y);
          const anchor = side ? (o.x > 0 ? 'start' : 'end') : 'middle';
          const y = p.y + o.y + (side ? 4 : o.y > 0 ? 8 : 0);
          const val = def.valueText?.(p.params) ?? '';
          label = `<text class="plabel" x="${p.x + o.x}" y="${y}" text-anchor="${anchor}"><tspan class="lname">${escapeXml(p.label)}</tspan>${val ? `<tspan class="lval" dx="5">${escapeXml(val)}</tspan>` : ''}</text>`;
        }
        let readout = '';
        const lcd = LCD_WIDTH[p.type];
        let o: Pt | null = null;
        if (p.type === 'voltmeter' || p.type === 'ammeter') {
          // Meter displays stay readable: under the meter when it lies flat, beside its label when upright.
          o = p.rot % 2 === 1 ? { x: 64, y: 20 } : rotatePt(def.readoutAt!, p.rot % 2);
        } else if (p.type === 'psu') o = p.rot % 2 === 0 ? { x: 92, y: 18 } : { x: 0, y: 52 };
        else if (p.type === 'probe') o = rotatePt({ x: 0, y: -31 }, p.rot);
        else if (def.readoutAt) o = rotatePt(def.readoutAt, p.rot);
        if (o) {
          if (lcd) readout += `<rect class="lcd" x="${p.x + o.x - lcd / 2}" y="${p.y + o.y - 10}" width="${lcd}" height="18" rx="3"/>`;
          const txt = p.type === 'probe' ? `CH${p.params.ch}` : '';
          readout += `<text class="readout${lcd ? ' meter' : ''}" x="${p.x + o.x}" y="${p.y + o.y + 4}" text-anchor="middle">${txt}</text>`;
        }
        const smoke = broken
          ? `<g class="smoke" transform="translate(${p.x} ${p.y - 10})"><circle r="5"/><circle r="4" cx="6"/><circle r="3" cx="-5"/></g><text class="broken-x" x="${p.x}" y="${p.y + 5}" text-anchor="middle">✕</text>`
          : '';
        const pins = def.pins.length;
        if (pins === 2) {
          const a = pinWorld(p, 0);
          const c = pinWorld(p, 1);
          flows.push(`<line class="flow" data-part="${p.id}" data-pin="0" data-sign="1" x1="${a.x}" y1="${a.y}" x2="${c.x}" y2="${c.y}"/>`);
        } else if (pins > 2) {
          for (let i = 0; i < pins; i++) {
            const a = pinWorld(p, i);
            flows.push(`<line class="flow" data-part="${p.id}" data-pin="${i}" data-sign="1" x1="${a.x}" y1="${a.y}" x2="${p.x}" y2="${p.y}"/>`);
          }
        }
        return `<g class="${cls}" data-id="${p.id}">
          <g transform="translate(${p.x} ${p.y}) rotate(${p.rot * 90})">
            <rect class="hit" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>
            <g class="sym">${symbolSvg(p.type, p.params, std, p.rot)}</g>
          </g>${label}${readout}${smoke}</g>`;
      })
      .join('');
    this.gFlows.innerHTML = flows.join('');

    this.collectRefs();
    this.drawOverlay();
    this.drawGhost();
    this.updateHint();
    this.frame(true);
  }

  private collectRefs(): void {
    this.partRefs.clear();
    this.wireRefs.clear();
    for (const g of this.gParts.querySelectorAll<SVGGElement>('.part')) {
      const id = g.dataset.id!;
      this.partRefs.set(id, {
        glows: [...g.querySelectorAll<SVGElement>('.glow')],
        heat: g.querySelector('.heat'),
        readout: g.querySelector('.readout'),
        lin: g.querySelector('.lin'),
        lout: g.querySelector('.lout'),
        segs: [...g.querySelectorAll<SVGElement>('.seg')],
        flows: [],
      });
    }
    for (const f of this.gFlows.querySelectorAll<SVGLineElement>('.flow')) {
      const r = this.partRefs.get(f.dataset.part!);
      r?.flows.push({ el: f, pin: Number(f.dataset.pin), sign: Number(f.dataset.sign) });
    }
    for (const g of this.gWires.querySelectorAll<SVGGElement>('.wire')) {
      this.wireRefs.set(g.dataset.id!, { line: g.querySelector('.w')!, flow: g.querySelector('.flow')! });
    }
  }

  private drawOverlay(): void {
    const app = this.app;
    const out: string[] = [];
    const count = new Map<string, number>();
    const bump = (p: Pt) => count.set(keyOf(p), (count.get(keyOf(p)) ?? 0) + 1);
    for (const w of app.doc.wires) {
      bump(w.a);
      bump(w.b);
    }
    for (const p of app.doc.parts) for (let i = 0; i < defOf(p.type).pins.length; i++) bump(pinWorld(p, i));
    for (const [k, n] of count) {
      const [x, y] = k.split(',').map(Number);
      if (n >= 3) out.push(`<circle class="junction" cx="${x}" cy="${y}" r="4"/>`);
      else if (n === 1 && app.doc.parts.some((p) => defOf(p.type).pins.some((_, i) => keyOf(pinWorld(p, i)) === k)))
        out.push(`<circle class="openpin" cx="${x}" cy="${y}" r="3.5"/>`);
    }
    for (const id of app.sel.parts) {
      const p = app.part(id);
      if (!p) continue;
      const b = this.partBox(p);
      out.push(`<rect class="selbox" x="${b.x - 6}" y="${b.y - 6}" width="${b.w + 12}" height="${b.h + 12}" rx="6"/>`);
    }
    const d = this.drag;
    if (d?.kind === 'box') {
      const x = Math.min(d.start.x, d.cur.x);
      const y = Math.min(d.start.y, d.cur.y);
      out.push(`<rect class="marquee" x="${x}" y="${y}" width="${Math.abs(d.cur.x - d.start.x)}" height="${Math.abs(d.cur.y - d.start.y)}"/>`);
    }
    if (d?.kind === 'wire' && d.moved) {
      const w = this.hoverWorld;
      const end = this.hover ?? { x: snap(w.x), y: snap(w.y) };
      out.push(this.previewWire(d.from, end));
    } else if (this.pendingWire) {
      const w = this.hoverWorld;
      const end = this.hover ?? { x: snap(w.x), y: snap(w.y) };
      out.push(this.previewWire(this.pendingWire, end));
      out.push(`<circle class="pinhover" cx="${this.pendingWire.x}" cy="${this.pendingWire.y}" r="7"/>`);
    }
    if (this.hover) out.push(`<circle class="pinhover" cx="${this.hover.x}" cy="${this.hover.y}" r="7"/>`);
    this.gOver.innerHTML = out.join('');
  }

  private previewWire(a: Pt, b: Pt): string {
    const ws = lWires(a, b);
    return ws.map((w) => `<line class="wirepreview" x1="${w.a.x}" y1="${w.a.y}" x2="${w.b.x}" y2="${w.b.y}"/>`).join('');
  }

  private drawGhost(): void {
    const type = this.app.placing;
    if (!type) {
      this.gGhost.innerHTML = '';
      return;
    }
    const x = snap(this.hoverWorld.x);
    const y = snap(this.hoverWorld.y);
    const params = Object.fromEntries(defOf(type).params.map((p) => [p.key, p.def]));
    this.gGhost.innerHTML = `<g class="part ghostpart" transform="translate(${x} ${y})"><g class="sym">${symbolSvg(type, params, this.app.std)}</g></g>`;
  }

  // ------------------------------------------------------------ live animation

  frame(still = false): void {
    const now = performance.now();
    const dt = still || !this.lastFrame ? 0 : Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    const app = this.app;
    const e = app.engine;
    if (!e) return;
    const moving = app.running && !e.failure;
    const net = e.net;

    // Voltage colours.
    let vmax = 1;
    for (let i = 0; i < e.n; i++) vmax = Math.max(vmax, Math.abs(e.x[i]));
    const hot: [number, number, number] = [224, 83, 61];
    const cold: [number, number, number] = [59, 125, 216];
    const colorFor = (v: number): string => {
      if (!app.showVolt) return '';
      const k = Math.min(1, Math.abs(v) / vmax);
      return mix(this.neutral, v >= 0 ? hot : cold, k * 0.95);
    };

    const wireI = app.showCurrent ? e.wireCurrents(app.doc) : null;
    for (const w of app.doc.wires) {
      const r = this.wireRefs.get(w.id);
      if (!r) continue;
      const node = net.pointNode.get(keyOf(w.a));
      const c = node === undefined ? '' : colorFor(e.volt(node));
      r.line.style.stroke = c;
      this.animateFlow(r.flow, wireI?.get(w.id) ?? 0, moving ? dt : 0, !!wireI);
    }

    for (const p of app.doc.parts) {
      const r = this.partRefs.get(p.id);
      const dev = e.byId.get(p.id);
      if (!r || !dev) continue;
      const broken = app.broken.has(p.id);
      const x = dev.extra();
      for (const f of r.flows) this.animateFlow(f.el, broken ? 0 : (dev.cur[f.pin] ?? 0) * f.sign, moving ? dt : 0, !!wireI);
      if (p.type === 'lamp' || p.type === 'led') {
        const b = broken ? 0 : Math.max(0, Math.min(1.2, x.brightness ?? 0));
        const k = Math.sqrt(Math.min(1, b));
        for (const g of r.glows) g.style.opacity = String(k * 0.85);
      }
      if (p.type === 'logicout') {
        for (const g of r.glows) g.style.opacity = x.level ? '0.9' : '0';
        if (r.readout) r.readout.textContent = x.level ? '1' : '0';
      }
      if (p.type === 'logicin') {
        const on = Number(p.params.state) === 1;
        r.lin?.classList.toggle('on', on);
        if (r.readout) r.readout.textContent = on ? '1' : '0';
      }
      if (r.heat && p.type === 'resistor') {
        const ratio = x.heat ?? 0;
        r.heat.style.fillOpacity = String(Math.min(0.9, Math.max(0, (ratio - 0.5) * 1.6)));
      }
      if (p.type === 'sevenseg') {
        for (const seg of r.segs) {
          const b = broken ? 0 : Math.min(1, x[`seg_${seg.dataset.seg}`] ?? 0);
          seg.style.opacity = String(0.1 + 0.9 * Math.sqrt(b));
        }
      }
      if (r.readout && p.type === 'multimeter') r.readout.textContent = broken ? '— — —' : multimeterText(String(p.params.mode), x.reading ?? 0);
      if (r.readout && p.type === 'psu') {
        const v = e.volt(dev.nodes[0]) - e.volt(dev.nodes[1]);
        r.readout.textContent = `${fmt(v, 'V', 3)}  ${fmt(x.iout ?? 0, 'A', 2)}${x.cc ? ' CC' : ''}`;
      }
      if (r.readout && (p.type === 'voltmeter' || p.type === 'ammeter')) {
        const unit = p.type === 'voltmeter' ? 'V' : 'A';
        const ac = p.params.mode === 'ac' ? '~' : '';
        r.readout.textContent = broken ? '— — —' : `${fmt(x.reading ?? 0, unit, 3)}${ac}`;
      }
    }
  }

  private animateFlow(el: SVGElement, current: number, dt: number, show: boolean): void {
    const a = Math.abs(current);
    if (!show || a < 1e-6) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    const speed = Math.sign(current) * Math.min(260, 45 * Math.log10(a / 1e-6));
    const off = (this.offsets.get(el) ?? 0) - speed * dt;
    this.offsets.set(el, off % 1000);
    el.style.strokeDashoffset = String(off % 1000);
  }
}

const LCD_WIDTH: Record<string, number> = { voltmeter: 68, ammeter: 68, multimeter: 54, psu: 112 };

/** What the multimeter screen shows in each selector position. */
export function multimeterText(mode: string, v: number): string {
  if (!Number.isFinite(v)) return 'OL';
  switch (mode) {
    case 'vac':
      return `${fmt(v, 'V', 3)}~`;
    case 'adc':
      return fmt(v, 'A', 3);
    case 'aac':
      return `${fmt(v, 'A', 3)}~`;
    case 'ohm':
      return `${fmt(v, 'Ω', 3)}${v < 30 ? ' •))' : ''}`;
    case 'diode':
      return fmt(v, 'V', 3);
    default:
      return fmt(v, 'V', 3);
  }
}

function defName(type: string): string {
  const d = defOf(type);
  return document.documentElement.lang === 'en' ? d.en : d.ar;
}

