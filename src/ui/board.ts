import { t } from '../i18n';
import { insertIntoWires, makePart, newId, routeWire } from '../model/docops';
import { defOf, pinWorld } from '../model/library';
import { logicNodes, logicState, type LogicNode, type LogicState } from './logic-nodes';
import { GRID, keyOf, orientPt, rotatePt, snap, type CircuitDoc, type Part, type Pt, type Wire } from '../model/types';
import { fmt } from '../units';
import type { App } from './app';
import { icon } from './dom';
import { symbolSvg } from './symbols';

const NS = 'http://www.w3.org/2000/svg';

interface PartRefs {
  glows: SVGElement[];
  heat: SVGElement | null;
  readout: SVGTextElement | null;
  lin: SVGElement | null;
  lout: SVGElement | null;
  segs: SVGElement[];
  /** Sound waves drawn above a speaker or buzzer. */
  waves: SVGElement | null;
  flows: { el: SVGLineElement; pin: number; sign: number }[];
}

interface WireRefs {
  line: SVGLineElement;
  flow: SVGLineElement;
  /** Logic state last drawn on a digital wire ('' for analog wires). */
  state?: string;
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
  | {
      kind: 'wire';
      from: Pt;
      moved: boolean;
      onWire: boolean;
      pointer: number;
      hFirst?: boolean;
      /** Touch only: the part whose pin the finger landed on, selected if the finger does not move. */
      touchPart?: string;
      /** Touch only: the wire under the finger (wire ends count as pins), selected on a plain tap. */
      touchWire?: string;
    }
  | {
      kind: 'pan';
      start: Pt;
      orig: Pt;
      pointer: number;
      moved: boolean;
      /** A finger tap (no movement) on empty board clears the selection. */
      clearOnTap: boolean;
    }
  | { kind: 'pinch'; dist: number; zoom: number; mid: Pt; pan: Pt };

interface Attach {
  part: string;
  wire: string;
  end: 'a' | 'b';
  pin: number;
}

/**
 * Everything that goes into the drawing is written as text, never as markup. It takes any value
 * (a circuit file may hold something that is not a string at all) and single quotes are escaped
 * too, so the result is safe inside an attribute however it is quoted.
 */
const escapeXml = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A number on its way into the drawing: anything else becomes 0 rather than markup. */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

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
  /** Phone "move" mode: the next tap on the board puts this part there. */
  private movingPart: string | null = null;
  private pendingDir: boolean | undefined;
  private hover: Pt | null = null;
  private hoverWorld: Pt = { x: 0, y: 0 };
  private neutral: [number, number, number] = [120, 130, 140];
  private vPos: [number, number, number] = [16, 185, 129];
  private vNeg: [number, number, number] = [244, 63, 94];
  private logicColor: Record<LogicState, string> = { '1': '#10b981', '0': '#3b82f6', Z: '#f59e0b', X: '#ef4444' };
  /** Digital nodes of the current engine (its wiring never changes, so this is worked out once). */
  private logic: { engine: unknown; nodes: Map<number, LogicNode> } | null = null;
  private lastFrame = 0;
  /** Small bar of actions that floats over the selected part. */
  private ctxBar!: HTMLElement;
  /** The ⚙ button on that bar: show the part's properties (the phone opens its sheet). */
  onProperties?: () => void;

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
        <pattern id="gridmajor" width="${GRID * 5}" height="${GRID * 5}" patternUnits="userSpaceOnUse">
          <path d="M0 0H${GRID * 5}M0 0V${GRID * 5}" class="gridline"/>
        </pattern>
        <filter id="halo" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
      </defs>
      <rect class="gridbg" x="0" y="0" width="100%" height="100%" fill="url(#gridmajor)"/>
      <rect class="gridbg minor" x="0" y="0" width="100%" height="100%" fill="url(#grid)"/>
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
    this.ctxBar = this.makeCtxBar();
    host.appendChild(this.ctxBar);

    this.readTheme();
    // Wire colours come from the theme: follow both the device setting and the in-app switch.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readTheme());
    new MutationObserver(() => {
      this.readTheme();
      this.frame(true);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => {
      this.up(e);
      this.placeCtxBar();
    });
    this.svg.addEventListener('pointercancel', (e) => {
      this.up(e, true);
      this.placeCtxBar();
    });
    this.svg.addEventListener('pointerleave', () => {
      this.hover = null;
      this.drawOverlay();
    });
    this.svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());

    app.on('doc', () => this.render());
    app.on('select', () => this.render());
    app.on('mode', () => {
      this.placeCtxBar();
      this.pendingWire = null;
      this.updateHint();
      this.drawGhost();
    });
    app.on('frame', () => this.frame());
    app.on('settings', () => this.frame());
  }

  private readTheme(): void {
    const css = getComputedStyle(document.documentElement);
    const hex = (name: string) => {
      const v = css.getPropertyValue(name).trim();
      return v.startsWith('#') ? v : null;
    };
    const rgb = (name: string, fallback: [number, number, number]) => {
      const v = hex(name);
      return v ? hexToRgb(v) : fallback;
    };
    this.neutral = rgb('--wire', this.neutral);
    this.vPos = rgb('--v-pos', this.vPos);
    this.vNeg = rgb('--v-neg', this.vNeg);
    for (const [s, name] of [['1', '--logic-1'], ['0', '--logic-0'], ['Z', '--logic-z'], ['X', '--logic-x']] as const) {
      this.logicColor[s] = hex(name) ?? this.logicColor[s];
    }
  }

  private logicNodesOf(e: App['engine']): Map<number, LogicNode> {
    if (this.logic?.engine !== e) this.logic = { engine: e, nodes: logicNodes(this.app.doc, e.net) };
    return this.logic.nodes;
  }

  // ------------------------------------------------------------ coordinates

  private makeCtxBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'ctxbar';
    bar.hidden = true;
    const btn = (act: string, ic: string, label: string) =>
      `<button type="button" data-ctx="${act}" title="${label}" aria-label="${label}">${icon(ic)}</button>`;
    bar.innerHTML =
      btn('rotate', 'rotate', `${t('rotate')} (R)`) +
      btn('flip', 'flip', `${t('flipTip')} (F)`) +
      btn('duplicate', 'copy', `${t('duplicate')} (Ctrl+D)`) +
      btn('props', 'props', t('props')) +
      `<span class="ctx-sep"></span>` +
      btn('delete', 'trash', `${t('delete')} (Delete)`);
    // The bar sits on the board: keep its taps away from the board's own pointer handling.
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-ctx]');
      if (!b) return;
      const act = b.dataset.ctx;
      if (act === 'rotate') this.rotateSelected();
      if (act === 'flip') this.flipSelected();
      if (act === 'duplicate') this.duplicateSelected();
      if (act === 'delete') this.deleteSelected();
      if (act === 'props') this.onProperties?.();
    });
    return bar;
  }

  /**
   * Put the action bar just above the selected part (below it when there is no room above),
   * kept inside the board. Hidden while the board or a part is being dragged.
   */
  private placeCtxBar(): void {
    const bar = this.ctxBar;
    if (!bar) return;
    const s = this.app.selection;
    const part = s?.kind === 'part' && this.app.selCount === 1 ? this.app.part(s.id) : undefined;
    const busy = (this.drag && this.drag.kind !== 'wire') || this.pointers.size > 1 || this.movingPart || this.app.placing;
    if (!part || busy) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const box = this.partBox(part);
    const z = this.zoom;
    const left = (box.x - 6) * z + this.pan.x;
    const right = (box.x + box.w + 6) * z + this.pan.x;
    const top = (box.y - 6) * z + this.pan.y;
    const bottom = (box.y + box.h + 6) * z + this.pan.y;
    const host = this.svg.getBoundingClientRect();
    const w = bar.offsetWidth;
    const h = bar.offsetHeight;
    const gap = 8;
    let y = top - h - gap;
    if (y < 8) y = bottom + gap;
    if (y + h > host.height - 8) y = Math.max(8, top - h - gap);
    const x = Math.min(Math.max(8, (left + right) / 2 - w / 2), Math.max(8, host.width - w - 8));
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private applyView(): void {
    this.vp.setAttribute('transform', `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`);
    const tf = `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`;
    this.svg.querySelector('#grid')!.setAttribute('patternTransform', tf);
    this.svg.querySelector('#gridmajor')!.setAttribute('patternTransform', tf);
    // Zoomed far out, the small dots would only blur into a grey haze: keep just the major lines.
    this.svg.classList.toggle('far', this.zoom < 0.55);
    this.placeCtxBar();
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
    ].map((q) => orientPt(q, p.rot, p.flip));
    const x = Math.min(c[0].x, c[1].x);
    const y = Math.min(c[0].y, c[1].y);
    return { x: p.x + x, y: p.y + y, w: Math.abs(c[1].x - c[0].x), h: Math.abs(c[1].y - c[0].y) };
  }

  // ------------------------------------------------------------ hit testing

  /** Nearest pin or wire end within reach of the pointer. */
  private connectable(w: Pt, touch: boolean): Pt | null {
    const reach = (touch ? 22 : 14) / this.zoom;
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

    if (this.movingPart) {
      const id = this.movingPart;
      const onSelf = (e.target as Element).closest<SVGGElement>('.part')?.dataset.id === id;
      this.endMoveMode();
      // On the part itself the finger drags it as usual; anywhere else is its new place.
      if (!onSelf) {
        this.movePartTo(id, s);
        app.select({ kind: 'part', id });
        return;
      }
    }

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
      this.addWire(this.pendingWire, end, this.pendingDir);
      this.pendingWire = null;
      this.pendingDir = undefined;
      this.updateHint();
      this.drawOverlay();
      return;
    }

    const pin = this.connectable(w, touch);
    const target = e.target as Element;
    const partEl = target.closest('.part') as SVGGElement | null;
    const wireEl = target.closest('.wire') as SVGGElement | null;

    // A finger is wide: on a zoomed-out phone the pin catch area covers the whole part. Start a
    // wire from a part's pin only when the finger is right on the pin; elsewhere on the part
    // the touch selects or moves the part, like any phone app.
    const onPinProper = pin && (!touch || this.nearPinScreen(pin, w, this.touchPinReach(partEl)));
    if (pin && onPinProper && !(partEl && defOf(app.part(partEl.dataset.id!)!.type).interactive && !this.nearPinOnly(pin, w))) {
      this.drag = {
        kind: 'wire',
        from: pin,
        moved: false,
        onWire: false,
        pointer: e.pointerId,
        touchPart: touch ? partEl?.dataset.id : undefined,
        touchWire: touch && !partEl ? wireEl?.dataset.id : undefined,
      };
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
      // A tap on the part that is already selected selects it again: on a phone that re-opens
      // the properties sheet if it was closed.
      if (!app.isSelected('part', id) || (touch && app.selCount === 1)) app.select({ kind: 'part', id });
      this.startGroupDrag(w, id, e.pointerId);
      if (defOf(part.type).interactive === 'momentary') {
        app.setParam(id, 'closed', 1, false);
        app.onSwitch?.();
      }
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
      // A finger on a wire selects it and pans the board if it moves: with the wide touch area,
      // drawing a wire from the middle of another wire would happen by accident while panning.
      if (touch) this.drag = { kind: 'pan', start: this.screen(e), orig: { ...this.pan }, pointer: e.pointerId, moved: false, clearOnTap: false };
      else this.drag = { kind: 'wire', from: s, moved: false, onWire: true, pointer: e.pointerId };
      return;
    }
    // Empty board: the mouse draws a selection box; touch, right and middle buttons pan.
    if (!touch && e.button === 0) {
      if (!additive) app.select(null);
      this.drag = { kind: 'box', start: w, cur: w, add: additive, pointer: e.pointerId };
      return;
    }
    this.drag = { kind: 'pan', start: this.screen(e), orig: { ...this.pan }, pointer: e.pointerId, moved: false, clearOnTap: touch };
  }

  /** Whether the pointer is within `px` screen pixels of a pin. */
  private nearPinScreen(pin: Pt, w: Pt, px: number): boolean {
    return Math.hypot(pin.x - w.x, pin.y - w.y) * this.zoom < px;
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
      if (Math.hypot(s.x - d.start.x, s.y - d.start.y) > 6) d.moved = true;
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
      // The phone's properties sheet steps aside while a part is being dragged.
      if (d.moved) document.body.classList.add('board-dragging');
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
      d.hFirst ??= this.firstDirection(d.from, w);
    }
    if (this.pendingWire) this.pendingDir ??= this.firstDirection(this.pendingWire, w);
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
    document.body.classList.remove('board-dragging');
    const app = this.app;
    if (d.kind === 'group') {
      const part = d.clicked ? app.part(d.clicked) : undefined;
      const def = part ? defOf(part.type) : undefined;
      if (part && def?.interactive === 'momentary') {
        app.setParam(part.id, 'closed', 0, false);
        app.onSwitch?.();
      }
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
        app.onSwitch?.();
      } else if (!cancelled && part && app.selCount > 1) {
        // A plain click on one item of a group selects just that item.
        app.select({ kind: 'part', id: part.id });
      }
      return;
    }
    // A tap on empty board (no drag) clears the selection, which also closes the phone's sheet.
    if (d.kind === 'pan') {
      if (d.clearOnTap && !d.moved && !cancelled) app.select(null);
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
        this.addWire(d.from, end, d.hFirst);
      } else if (e.pointerType === 'touch') {
        // Phones draw wires by dragging only; a tap on a pin selects its part, on a wire end the wire.
        if (d.touchPart) app.select({ kind: 'part', id: d.touchPart });
        else if (d.touchWire) app.select({ kind: 'wire', id: d.touchWire });
        else app.select(null);
      } else if (!d.onWire) {
        this.pendingWire = d.from;
        this.pendingDir = undefined;
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
    document.body.classList.remove('board-dragging');
    // A push button held by the first finger must not stay closed when a second finger arrives.
    if (d?.kind === 'group' && d.clicked) {
      const part = this.app.part(d.clicked);
      if (part && defOf(part.type).interactive === 'momentary' && Number(part.params.closed) === 1) {
        this.app.setParam(part.id, 'closed', 0, false);
        this.app.onSwitch?.();
      }
    }
    this.drag = null;
  }

  /**
   * How close (screen px) a finger must be to a pin to start a wire. Small parts get a smaller
   * reach so that, zoomed out, they can still be grabbed and moved by their body.
   */
  private touchPinReach(partEl: SVGGElement | null): number {
    const part = partEl ? this.app.part(partEl.dataset.id!) : undefined;
    if (!part) return 14;
    const b = this.partBox(part);
    return Math.min(b.w, b.h) * this.zoom < 44 ? 8 : 14;
  }

  /**
   * Which way the wire leaves its start: the way the pointer first moved, once it has moved
   * far enough to tell. This decides where the corner of an L-shaped wire goes.
   */
  private firstDirection(from: Pt, w: Pt): boolean | undefined {
    const dx = w.x - from.x;
    const dy = w.y - from.y;
    if (Math.hypot(dx, dy) < 12 / this.zoom) return undefined;
    return Math.abs(dx) >= Math.abs(dy);
  }

  private route(a: Pt, b: Pt, hFirst?: boolean): Wire[] {
    return routeWire(this.app.doc, a, b, hFirst);
  }

  private addWire(a: Pt, b: Pt, hFirst?: boolean): void {
    const wires = this.route(a, b, hFirst);
    if (wires.length) this.app.commit((d) => d.wires.push(...wires));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), this.screen(e));
  }

  /** Esc: stop placing or drawing. */
  cancel(): boolean {
    if (this.movingPart) {
      this.endMoveMode();
      return true;
    }
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

  /**
   * Phone "move" mode: the properties sheet steps aside and the next tap on the board says where
   * the part goes. Dragging the part with a finger still works too.
   */
  startMoveMode(id: string): void {
    if (!this.app.part(id)) return;
    this.movingPart = id;
    document.body.classList.add('board-moving');
    this.updateHint();
  }

  private endMoveMode(): void {
    this.movingPart = null;
    document.body.classList.remove('board-moving');
    this.updateHint();
  }

  /** Put a part at a grid point; the wires on its pins follow. */
  private movePartTo(id: string, at: Pt): void {
    this.app.commit((d) => {
      const p = d.parts.find((q) => q.id === id);
      if (!p || (p.x === at.x && p.y === at.y)) return;
      const att = attachments(d, p);
      p.x = at.x;
      p.y = at.y;
      followPins(d, p, att);
    });
  }

  /**
   * Scroll the board so a selected part or wire is not hidden under something covering the
   * bottom of the screen (the phone's properties sheet), whose top edge is `coverTop` (client px).
   */
  reveal(sel: { kind: 'part' | 'wire'; id: string }, coverTop: number): void {
    const r = this.svg.getBoundingClientRect();
    let y0: number;
    let y1: number;
    if (sel.kind === 'part') {
      const p = this.app.part(sel.id);
      if (!p) return;
      const b = this.partBox(p);
      y0 = b.y;
      y1 = b.y + b.h;
    } else {
      const w = this.app.doc.wires.find((x) => x.id === sel.id);
      if (!w) return;
      y0 = Math.min(w.a.y, w.b.y);
      y1 = Math.max(w.a.y, w.b.y);
    }
    const top = r.top + y0 * this.zoom + this.pan.y;
    const bottom = r.top + y1 * this.zoom + this.pan.y;
    const visTop = r.top + 8;
    const visBottom = Math.min(r.bottom, coverTop) - 12;
    if (top >= visTop && bottom <= visBottom) return;
    // Centre it in the part of the board that is still visible.
    const shift = (visTop + visBottom) / 2 - (top + bottom) / 2;
    this.pan = { x: this.pan.x, y: this.pan.y + shift };
    this.applyView();
  }

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

  /** Mirror the selected part top to bottom, e.g. a transistor with its emitter on top. */
  flipSelected(): void {
    const s = this.app.selection;
    if (s?.kind !== 'part') return;
    this.app.commit((d) => {
      const p = d.parts.find((q) => q.id === s.id);
      if (!p) return;
      const att = attachments(d, p);
      if (p.flip) delete p.flip;
      else p.flip = true;
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
        if (src.flip) p.flip = true;
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
    const moving = this.movingPart ? app.part(this.movingPart) : undefined;
    if (moving) {
      this.hint.textContent = t('moveHint', { label: moving.label });
      this.hint.hidden = false;
    } else if (app.placing) {
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
        const xy = `x1="${num(w.a.x)}" y1="${num(w.a.y)}" x2="${num(w.b.x)}" y2="${num(w.b.y)}"`;
        return `<g class="wire${cls}" data-id="${escapeXml(w.id)}"><line class="hit" ${xy}/><line class="w" ${xy}/><line class="flow" ${xy}/></g>`;
      })
      .join('');

    const flows: string[] = [];
    this.gParts.innerHTML = app.doc.parts
      .map((p) => {
        const def = defOf(p.type);
        const b = def.box;
        const broken = app.broken.has(p.id);
        const cls = `part type-${escapeXml(p.type)}${app.isSelected('part', p.id) ? ' selected' : ''}${broken ? ' broken' : ''}${def.interactive ? ' interactive' : ''}`;
        let label = '';
        if (def.labelAt) {
          // Upside-down parts keep their label on top, and upright ones always on the right.
          const o = rotatePt(def.labelAt, p.rot % 2);
          const side = Math.abs(o.x) > Math.abs(o.y);
          const anchor = side ? (o.x > 0 ? 'start' : 'end') : 'middle';
          const y = p.y + o.y + (side ? 4 : o.y > 0 ? 8 : 0);
          const val = def.valueText?.(p.params) ?? '';
          label = `<text class="plabel" x="${num(p.x + o.x)}" y="${num(y)}" text-anchor="${anchor}"><tspan class="lname">${escapeXml(p.label)}</tspan>${val ? `<tspan class="lval" dx="5">${escapeXml(val)}</tspan>` : ''}</text>`;
        }
        let readout = '';
        const lcd = LCD_WIDTH[p.type];
        let o: Pt | null = null;
        if (p.type === 'voltmeter' || p.type === 'ammeter') {
          // Meter displays stay readable: under the meter when it lies flat, beside its label when upright.
          o = p.rot % 2 === 1 ? { x: 64, y: 20 } : rotatePt(def.readoutAt!, p.rot % 2);
        } else if (p.type === 'psu') o = p.rot % 2 === 0 ? { x: 92, y: 18 } : { x: 0, y: 52 };
        else if (p.type === 'probe') o = rotatePt({ x: 0, y: -31 }, p.rot);
        else if (def.readoutAt) o = orientPt(def.readoutAt, p.rot, p.flip);
        if (o) {
          if (lcd) readout += `<rect class="lcd" x="${num(p.x + o.x - lcd / 2)}" y="${num(p.y + o.y - 10)}" width="${lcd}" height="18" rx="3"/>`;
          const txt = p.type === 'probe' ? `CH${escapeXml(p.params.ch)}` : '';
          readout += `<text class="readout${lcd ? ' meter' : ''}" x="${num(p.x + o.x)}" y="${num(p.y + o.y + 4)}" text-anchor="middle">${txt}</text>`;
        }
        const smoke = broken
          ? `<g class="smoke" transform="translate(${num(p.x)} ${num(p.y - 10)})"><circle r="5"/><circle r="4" cx="6"/><circle r="3" cx="-5"/></g><text class="broken-x" x="${num(p.x)}" y="${num(p.y + 5)}" text-anchor="middle">✕</text>`
          : '';
        const pins = def.pins.length;
        if (pins === 2) {
          const a = pinWorld(p, 0);
          const c = pinWorld(p, 1);
          flows.push(`<line class="flow" data-part="${escapeXml(p.id)}" data-pin="0" data-sign="1" x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(c.x)}" y2="${num(c.y)}"/>`);
        } else if (pins > 2) {
          for (let i = 0; i < pins; i++) {
            const a = pinWorld(p, i);
            flows.push(`<line class="flow" data-part="${escapeXml(p.id)}" data-pin="${i}" data-sign="1" x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(p.x)}" y2="${num(p.y)}"/>`);
          }
        }
        return `<g class="${cls}" data-id="${escapeXml(p.id)}">
          <g transform="translate(${num(p.x)} ${num(p.y)}) rotate(${num(p.rot) * 90})${p.flip ? ' scale(1 -1)' : ''}">
            <rect class="hit" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>
            <g class="sym">${symbolSvg(p.type, p.params, std, p.rot, !!p.flip)}</g>
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
        waves: g.querySelector('.waves'),
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
    const wiring = (d?.kind === 'wire' && d.moved) || !!this.pendingWire;
    if (wiring) out.push(this.snapRings());
    if (d?.kind === 'wire' && d.moved) {
      const w = this.hoverWorld;
      const end = this.hover ?? { x: snap(w.x), y: snap(w.y) };
      out.push(this.previewWire(d.from, end, d.hFirst));
    } else if (this.pendingWire) {
      const w = this.hoverWorld;
      const end = this.hover ?? { x: snap(w.x), y: snap(w.y) };
      out.push(this.previewWire(this.pendingWire, end, this.pendingDir));
      out.push(`<circle class="pinhover" cx="${this.pendingWire.x}" cy="${this.pendingWire.y}" r="7"/>`);
    }
    if (this.hover) {
      // While a wire is being drawn the pin it will snap to gets a bold ring, sized for a finger.
      const r = wiring ? Math.max(9, 13 / this.zoom) : 7;
      out.push(`<circle class="pinhover${wiring ? ' snap' : ''}" cx="${this.hover.x}" cy="${this.hover.y}" r="${num(r)}"/>`);
    }
    this.gOver.innerHTML = out.join('');
  }

  /** Faint rings on the pins near the pointer while wiring, so the student sees where a wire can go. */
  private snapRings(): string {
    const w = this.hoverWorld;
    const near = 90 / this.zoom;
    const r = Math.max(6, 8 / this.zoom);
    const out: string[] = [];
    for (const p of this.app.doc.parts) {
      for (let i = 0; i < defOf(p.type).pins.length; i++) {
        const q = pinWorld(p, i);
        if (Math.abs(q.x - w.x) > near || Math.abs(q.y - w.y) > near) continue;
        out.push(`<circle class="snapring" cx="${q.x}" cy="${q.y}" r="${num(r)}"/>`);
      }
    }
    return out.join('');
  }

  private previewWire(a: Pt, b: Pt, hFirst?: boolean): string {
    const ws = this.route(a, b, hFirst);
    return ws.map((w) => `<line class="wirepreview" x1="${num(w.a.x)}" y1="${num(w.a.y)}" x2="${num(w.b.x)}" y2="${num(w.b.y)}"/>`).join('');
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
    this.gGhost.innerHTML = `<g class="part ghostpart" transform="translate(${num(x)} ${num(y)})"><g class="sym">${symbolSvg(type, params, this.app.std)}</g></g>`;
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
    const x = e.x;
    for (let i = 0; i < x.length; i++) vmax = Math.max(vmax, Math.abs(x[i]));
    // Analog: grey at 0 V, greener as it rises, rosier as it falls below ground.
    const colorFor = (v: number): string => {
      if (!app.showVolt) return '';
      const k = Math.min(1, Math.abs(v) / vmax);
      return mix(this.neutral, v >= 0 ? this.vPos : this.vNeg, k * 0.95);
    };
    // Digital: one clear colour per logic state.
    const logic = app.showVolt ? this.logicNodesOf(e) : null;

    const wireI = app.showCurrent ? e.wireCurrents(app.doc) : null;
    for (const w of app.doc.wires) {
      const r = this.wireRefs.get(w.id);
      if (!r) continue;
      const node = net.pointNode.get(keyOf(w.a));
      const info = node === undefined ? undefined : logic?.get(node);
      const state = info ? logicState(info, e.volt(node!)) : '';
      const c = node === undefined ? '' : state ? this.logicColor[state] : colorFor(e.volt(node));
      if (r.line.style.stroke !== c) r.line.style.stroke = c;
      if (r.state !== state) {
        r.state = state;
        r.line.dataset.logic = state;
      }
      this.animateFlow(r.flow, wireI?.get(w.id) ?? 0, moving ? dt : 0, !!wireI);
    }

    for (const p of app.doc.parts) {
      const r = this.partRefs.get(p.id);
      const dev = e.byId.get(p.id);
      if (!r || !dev) continue;
      const broken = app.broken.has(p.id);
      const x = dev.extra();
      for (const f of r.flows) this.animateFlow(f.el, broken ? 0 : (dev.cur[f.pin] ?? 0) * f.sign, moving ? dt : 0, !!wireI);
      if (p.type === 'lamp' || p.type === 'led' || p.type === 'irtx') {
        const b = broken ? 0 : Math.max(0, Math.min(1.2, x.brightness ?? 0));
        const k = Math.sqrt(Math.min(1, b));
        for (const g of r.glows) g.style.opacity = String(k * 0.85);
      }
      if (r.waves) {
        const loud = broken || !moving ? 0 : Math.min(1, x.loud ?? 0);
        r.waves.style.opacity = String(loud > 0.01 ? 0.35 + 0.65 * loud : 0);
        r.waves.classList.toggle('playing', loud > 0.01);
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
      if (p.type === 'sevenseg' || p.type === 'lcd7') {
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
      if (el.style.opacity !== '0') el.style.opacity = '0';
      return;
    }
    if (el.style.opacity !== '1') el.style.opacity = '1';
    if (dt === 0) return;
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

