import { nameOf, t } from '../i18n';
import { defOf } from '../model/library';
import type { Part } from '../model/types';
import { canTrace, partCurves, type IvPlot, type WasmEngine as Engine } from '../sim/wasm/engine';
import { fmt } from '../units';
import type { App } from './app';
import { $, icon } from './dom';


/** 1-2-5 steps like the knobs of a real oscilloscope. */
function steps(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
  return out;
}
const TIME_DIVS = steps(1e-6, 1);
const VOLT_DIVS = steps(1e-3, 50);

const HDIV = 10;
const VDIV = 8;
const PER_SCREEN = 500;
const HISTORY = 20000;
const COLORS = ['#f5c542', '#4fc3f7'];
const BG = '#0b1a16';
const GRID = 'rgba(120,200,170,0.16)';
const GRID_STRONG = 'rgba(120,200,170,0.42)';
const TEXT = 'rgba(205,240,226,0.85)';

interface Channel {
  /** Volts per division, or 0 for automatic. */
  vdiv: number;
  ac: boolean;
  /** Vertical position in divisions (+ moves the trace up). */
  pos: number;
}

interface Stats {
  min: number;
  max: number;
  mean: number;
  rms: number;
  freq: number | null;
  n: number;
}

interface BodePoint {
  f: number;
  db: number;
  phase: number;
}

type Tab = 'scope' | 'bode' | 'iv';

/** Frequency from rising crossings of the middle level, with hysteresis so noise is ignored. */
function measure(ts: number[], vs: number[]): Stats {
  const n = vs.length;
  if (!n) return { min: 0, max: 0, mean: 0, rms: 0, freq: null, n };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sq = 0;
  for (const v of vs) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    sq += v * v;
  }
  const mid = (min + max) / 2;
  const hyst = (max - min) * 0.1;
  const rises: number[] = [];
  let low = vs[0] < mid - hyst;
  for (let i = 1; i < n; i++) {
    if (vs[i] < mid - hyst) low = true;
    else if (low && vs[i] >= mid && vs[i - 1] < mid) {
      const k = (mid - vs[i - 1]) / (vs[i] - vs[i - 1] || 1);
      rises.push(ts[i - 1] + k * (ts[i] - ts[i - 1]));
      low = false;
    }
  }
  const freq = max - min > 1e-6 && rises.length >= 2 ? (rises.length - 1) / (rises[rises.length - 1] - rises[0]) : null;
  return { min, max, mean: sum / n, rms: Math.sqrt(sq / n), freq, n };
}

function niceDiv(v: number): number {
  if (!(v > 0)) return 1;
  return VOLT_DIVS.find((d) => d >= v) ?? VOLT_DIVS[VOLT_DIVS.length - 1];
}

/**
 * The instrument panel under the board: a two-channel oscilloscope with a time lever through its
 * memory, plus the Bode plotter and the characteristic-curve tracer.
 */
export class Scope {
  private el = $('#scope');
  private canvas!: HTMLCanvasElement;
  private tab: Tab = 'scope';

  // Acquisition memory (ring buffer).
  private tBuf = new Float64Array(HISTORY);
  private vBuf = [new Float64Array(HISTORY), new Float64Array(HISTORY)];
  private head = 0;
  private count = 0;
  private lastT = -1;
  private has = [false, false];
  private probes: (string | null)[] = [null, null];
  /** The engine and settings the core is currently recording for. */
  private watched: Engine | null = null;
  private watchKey = '';

  // Front panel.
  timeDiv = 2e-3;
  private running = true;
  private ch: Channel[] = [
    { vdiv: 0, ac: false, pos: 0 },
    { vdiv: 0, ac: false, pos: 0 },
  ];
  private trigSrc = 0;
  private trigRise = true;
  /** How far back in time the screen is, in divisions (the time lever). */
  private lever = 0;
  private frozenEnd = 0;
  private viewEnd = 0;
  private cursorsOn = false;
  private cursors = [3, 7];
  private drag: { kind: 'cursor'; i: number } | { kind: 'pan'; x: number; lever: number } | null = null;

  // Bode plotter.
  private hasBode = false;
  private bode: BodePoint[] = [];
  private bodeAt = 0;
  private bodeDirty = true;
  cutoffText = '';

  // Curve tracer.
  private iv: { part: Part; plot: IvPlot } | null = null;
  private hoverX: number | null = null;

  constructor(private app: App) {
    this.hasBode = app.doc.parts.some((p) => p.type === 'bode');
    if (this.hasBode) this.tab = 'bode';
    this.build();
    app.stepHooks.push((e) => this.sample(e));
    app.on('doc', () => {
      this.findProbes();
      this.bodeDirty = true;
      const has = app.doc.parts.some((p) => p.type === 'bode');
      if (has !== this.hasBode) {
        this.hasBode = has;
        this.tab = has ? 'bode' : this.tab === 'bode' ? 'scope' : this.tab;
        this.build();
      }
      if (this.iv && !app.part(this.iv.part.id)) {
        this.iv = null;
        if (this.tab === 'iv') this.tab = 'scope';
        this.build();
      }
    });
    this.findProbes();
    try {
      const h = localStorage.getItem('nabd.scopeHeight');
      if (h) this.el.style.height = h;
    } catch {
      /* ignore */
    }
    this.sync();
  }

  // ------------------------------------------------------------ panel

  build(): void {
    const tabs: [Tab, string][] = [['scope', t('scopeTab')]];
    if (this.hasBode) tabs.push(['bode', t('bodeTab')]);
    if (this.iv) tabs.push(['iv', t('ivTab')]);
    const tabHtml = `<div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let controls = '';
    let below = '';
    if (this.tab === 'scope') {
      const tdOpts = TIME_DIVS.map((v) => `<option value="${v}"${v === this.timeDiv ? ' selected' : ''}>${fmt(v, 's')}/div</option>`).join('');
      const vOpts = (c: number) =>
        `<option value="0"${this.ch[c].vdiv === 0 ? ' selected' : ''}>AUTO</option>` +
        VOLT_DIVS.map((v) => `<option value="${v}"${v === this.ch[c].vdiv ? ' selected' : ''}>${fmt(v, 'V')}/div</option>`).join('');
      const chan = (c: number) => `
        <div class="knobs ch-${c + 1}">
          <span class="ch ch${c + 1}">CH${c + 1}</span>
          <select data-vdiv="${c}" title="VOLTS/DIV">${vOpts(c)}</select>
          <button class="mini${this.ch[c].ac ? ' on' : ''}" data-ac="${c}" title="${t('coupling')}">${this.ch[c].ac ? 'AC' : 'DC'}</button>
          <button class="mini" data-pos="${c}:1" title="${t('position')} ▲">▲</button>
          <button class="mini" data-pos="${c}:-1" title="${t('position')} ▼">▼</button>
        </div>`;
      controls = `
        <button class="runstop ${this.running ? 'run' : 'stop'}" data-scope-run>${this.running ? 'RUN' : 'STOP'}</button>
        <div class="knobs">
          <span class="klabel">TIME/DIV</span>
          <button class="mini" data-td="-1" title="${t('faster')}">◀</button>
          <select data-timediv>${tdOpts}</select>
          <button class="mini" data-td="1" title="${t('slower')}">▶</button>
        </div>
        ${chan(0)}${chan(1)}
        <div class="knobs">
          <span class="klabel">TRIG</span>
          <select data-trig><option value="0"${this.trigSrc === 0 ? ' selected' : ''}>CH1</option><option value="1"${this.trigSrc === 1 ? ' selected' : ''}>CH2</option><option value="-1"${this.trigSrc === -1 ? ' selected' : ''}>${t('trigOff')}</option></select>
          <button class="mini" data-edge title="${t('edge')}">${this.trigRise ? '↑' : '↓'}</button>
        </div>
        <button class="mini wide${this.cursorsOn ? ' on' : ''}" data-cursors>${t('cursors')}</button>`;
      below = `
        <div class="lever" dir="ltr">
          <span class="klabel">${t('timeLever')}</span>
          <span class="lever-end">⟵ ${t('past')}</span>
          <input type="range" data-lever min="0" max="0" step="0.1" value="0">
          <span class="lever-end">${t('now')} ⟶</span>
          <b class="lever-val" data-lever-val>0</b>
          <button class="mini wide" data-live>${t('now')}</button>
        </div>
        <div class="meas" dir="ltr">
          <div class="mrow" data-meas="0"></div>
          <div class="mrow" data-meas="1"></div>
          <div class="mrow cur" data-meas="c" hidden></div>
        </div>`;
    } else if (this.tab === 'bode') {
      controls = `<div class="legend"><span class="ch ch1">${t('gain')}</span><span class="ch ch2">${t('phase')}</span><b id="bode-read" dir="ltr"></b></div><b class="cutoff" id="bode-fc"></b>`;
    } else if (this.iv) {
      controls = `<div class="legend"><b>${nameOf(defOf(this.iv.part.type))} ${this.iv.part.label}</b><b id="iv-read" dir="ltr"></b></div>`;
    }
    this.el.innerHTML = `
      <div class="scope-grip" title="${t('dragResize')}"></div>
      <div class="scope-head">
        ${tabHtml}
        ${controls}
        <button class="icon-btn scope-x" data-scope="close" title="${t('close')}">${icon('close')}</button>
      </div>
      <div class="screen"><canvas></canvas><p class="scope-empty" hidden></p></div>
      ${below}`;
    this.canvas = this.el.querySelector('canvas')!;
    this.bind();
  }

  private bind(): void {
    const el = this.el;
    el.querySelector('[data-scope="close"]')!.addEventListener('click', () => this.app.setOption('scopeOpen', false));
    el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        this.tab = b.dataset.tab as Tab;
        this.bodeDirty = true;
        this.build();
      }),
    );
    el.querySelector('[data-scope-run]')?.addEventListener('click', () => this.setRunning(!this.running));
    el.querySelector<HTMLSelectElement>('[data-timediv]')?.addEventListener('change', (e) => this.setTimeDiv(Number((e.target as HTMLSelectElement).value)));
    el.querySelectorAll<HTMLElement>('[data-td]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = TIME_DIVS.indexOf(this.timeDiv) + Number(b.dataset.td);
        if (TIME_DIVS[i]) this.setTimeDiv(TIME_DIVS[i]);
      }),
    );
    el.querySelectorAll<HTMLSelectElement>('[data-vdiv]').forEach((s) =>
      s.addEventListener('change', () => (this.ch[Number(s.dataset.vdiv)].vdiv = Number(s.value))),
    );
    el.querySelectorAll<HTMLElement>('[data-ac]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = this.ch[Number(b.dataset.ac)];
        c.ac = !c.ac;
        b.textContent = c.ac ? 'AC' : 'DC';
        b.classList.toggle('on', c.ac);
      }),
    );
    el.querySelectorAll<HTMLElement>('[data-pos]').forEach((b) =>
      b.addEventListener('click', () => {
        const [c, d] = b.dataset.pos!.split(':').map(Number);
        this.ch[c].pos = Math.max(-4, Math.min(4, this.ch[c].pos + d * 0.5));
      }),
    );
    el.querySelector<HTMLSelectElement>('[data-trig]')?.addEventListener('change', (e) => (this.trigSrc = Number((e.target as HTMLSelectElement).value)));
    el.querySelector('[data-edge]')?.addEventListener('click', (e) => {
      this.trigRise = !this.trigRise;
      (e.target as HTMLElement).textContent = this.trigRise ? '↑' : '↓';
    });
    el.querySelector('[data-cursors]')?.addEventListener('click', (e) => {
      this.cursorsOn = !this.cursorsOn;
      (e.target as HTMLElement).classList.toggle('on', this.cursorsOn);
      el.querySelector<HTMLElement>('[data-meas="c"]')!.hidden = !this.cursorsOn;
    });
    const lever = el.querySelector<HTMLInputElement>('[data-lever]');
    lever?.addEventListener('input', () => {
      if (this.running) this.setRunning(false);
      this.lever = Number(lever.max) - Number(lever.value);
    });
    el.querySelector('[data-live]')?.addEventListener('click', () => {
      this.lever = 0;
      this.setRunning(true);
    });

    // Drag the top edge to make the instrument taller or shorter.
    const grip = el.querySelector<HTMLElement>('.scope-grip')!;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      const y0 = e.clientY;
      const h0 = el.getBoundingClientRect().height;
      const move = (ev: PointerEvent) => {
        const h = Math.max(220, Math.min(window.innerHeight - 160, h0 + (y0 - ev.clientY)));
        el.style.height = `${h}px`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        try {
          localStorage.setItem('nabd.scopeHeight', el.style.height);
        } catch {
          /* ignore */
        }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });

    const cv = this.canvas;
    const dpr = () => window.devicePixelRatio || 1;
    cv.addEventListener('pointerdown', (e) => {
      if (this.tab !== 'scope') return;
      const x = (e.clientX - cv.getBoundingClientRect().left) * dpr();
      const W = cv.width;
      if (this.cursorsOn) {
        const i = this.cursors.findIndex((c) => Math.abs((c / HDIV) * W - x) < 12 * dpr());
        if (i >= 0) {
          this.drag = { kind: 'cursor', i };
          cv.setPointerCapture(e.pointerId);
          return;
        }
      }
      this.drag = { kind: 'pan', x, lever: this.lever };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const x = (e.clientX - cv.getBoundingClientRect().left) * dpr();
      this.hoverX = x;
      const d = this.drag;
      if (!d) return;
      const W = cv.width;
      if (d.kind === 'cursor') this.cursors[d.i] = Math.max(0, Math.min(HDIV, (x / W) * HDIV));
      else {
        // Dragging the trace to the right shows earlier moments, like turning the position knob.
        const lever = Math.max(0, d.lever + ((x - d.x) / W) * HDIV);
        if (lever !== this.lever && this.running) this.setRunning(false);
        this.lever = Math.min(lever, this.maxLever());
      }
    });
    const end = () => (this.drag = null);
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => (this.hoverX = null));
    cv.addEventListener(
      'wheel',
      (e) => {
        if (this.tab !== 'scope') return;
        e.preventDefault();
        const i = TIME_DIVS.indexOf(this.timeDiv) + (e.deltaY > 0 ? 1 : -1);
        if (TIME_DIVS[i]) this.setTimeDiv(TIME_DIVS[i]);
      },
      { passive: false },
    );
  }

  sync(): void {
    this.el.hidden = !this.app.scopeOpen;
    document.body.classList.toggle('scope-open', this.app.scopeOpen);
  }

  private setRunning(on: boolean): void {
    this.running = on;
    if (!on) this.frozenEnd = this.viewEnd || this.latest();
    else this.lever = 0;
    const b = this.el.querySelector<HTMLElement>('[data-scope-run]');
    if (b) {
      b.textContent = on ? 'RUN' : 'STOP';
      b.className = `runstop ${on ? 'run' : 'stop'}`;
    }
  }

  private setTimeDiv(v: number): void {
    this.timeDiv = v;
    const sel = this.el.querySelector<HTMLSelectElement>('[data-timediv]');
    if (sel) sel.value = String(v);
    this.clear();
    this.setRunning(true);
  }

  /** Examples give the whole screen width; the scope works in time per division. */
  setWindow(w: number): void {
    const target = w / HDIV;
    this.setTimeDiv(TIME_DIVS.reduce((a, b) => (Math.abs(Math.log(b / target)) < Math.abs(Math.log(a / target)) ? b : a)));
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
    this.lastT = -1;
    this.lever = 0;
  }

  showIv(part: Part): void {
    if (!canTrace(part.type)) return;
    this.iv = { part, plot: partCurves(part) };
    this.tab = 'iv';
    this.app.setOption('scopeOpen', true);
    this.build();
  }

  private findProbes(): void {
    this.probes = [null, null];
    for (const p of this.app.doc.parts) if (p.type === 'probe') this.probes[String(p.params.ch) === '2' ? 1 : 0] ??= p.id;
  }

  // ------------------------------------------------------------ acquisition

  /**
   * The core records the two probe voltages while it runs (500 samples per screen width);
   * after each batch the samples are copied into the scope's memory.
   */
  private sample(e: Engine): void {
    const nodes = this.probes.map((id) => (id ? e.byId.get(id)?.nodes[0] : undefined));
    const key = `${nodes.join()}|${this.timeDiv}`;
    if (e !== this.watched || key !== this.watchKey) {
      e.watch(nodes.map((n) => n ?? -1), (this.timeDiv * HDIV) / PER_SCREEN);
      this.watched = e;
      this.watchKey = key;
    }
    const { t, v } = e.takeTrace();
    if (!this.app.scopeOpen || !this.running) return;
    this.has = nodes.map((n) => n !== undefined);
    if (e.t < this.lastT) this.clear();
    for (let k = 0; k < t.length; k++) {
      if (t[k] < this.lastT) this.clear();
      this.lastT = t[k];
      this.tBuf[this.head] = t[k];
      this.vBuf[0][this.head] = v[2 * k];
      this.vBuf[1][this.head] = v[2 * k + 1];
      this.head = (this.head + 1) % HISTORY;
      this.count = Math.min(this.count + 1, HISTORY);
    }
  }

  private idx(k: number): number {
    return (this.head - this.count + k + HISTORY) % HISTORY;
  }

  private latest(): number {
    return this.count ? this.tBuf[this.idx(this.count - 1)] : 0;
  }

  private oldest(): number {
    return this.count ? this.tBuf[this.idx(0)] : 0;
  }

  private maxLever(): number {
    return Math.max(0, (this.latest() - this.oldest()) / this.timeDiv - HDIV);
  }

  /** Latest trigger crossing that still leaves half a screen after it, so the trace stands still. */
  private triggerTime(): number | null {
    const c = this.trigSrc;
    if (c < 0 || !this.has[c] || this.count < 4) return null;
    const span = this.timeDiv * HDIV;
    const tLast = this.latest();
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = this.count - 1; k >= 0; k--) {
      const i = this.idx(k);
      if (this.tBuf[i] < tLast - 2 * span) break;
      lo = Math.min(lo, this.vBuf[c][i]);
      hi = Math.max(hi, this.vBuf[c][i]);
    }
    if (hi - lo < 1e-6) return null;
    const level = (lo + hi) / 2;
    for (let k = this.count - 1; k > 0; k--) {
      const i = this.idx(k);
      const j = this.idx(k - 1);
      const t1 = this.tBuf[i];
      if (t1 > tLast - span / 2) continue;
      if (t1 < tLast - 3 * span) break;
      const a = this.vBuf[c][j];
      const b = this.vBuf[c][i];
      const crosses = this.trigRise ? a < level && b >= level : a > level && b <= level;
      if (crosses) {
        const f = (level - a) / (b - a || 1);
        return this.tBuf[j] + f * (t1 - this.tBuf[j]);
      }
    }
    return null;
  }

  // ------------------------------------------------------------ drawing

  private screen(): { g: CanvasRenderingContext2D; W: number; H: number; dpr: number } {
    const cv = this.canvas;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
    }
    const g = cv.getContext('2d')!;
    g.direction = 'ltr';
    g.fillStyle = BG;
    g.fillRect(0, 0, cv.width, cv.height);
    return { g, W: cv.width, H: cv.height, dpr };
  }

  private empty(msg: string | null): void {
    const p = this.el.querySelector<HTMLElement>('.scope-empty');
    if (!p) return;
    p.hidden = !msg;
    if (msg) p.textContent = msg;
  }

  draw(): void {
    if (this.hasBode) this.updateBode();
    if (!this.app.scopeOpen || !this.canvas) return;
    if (this.tab === 'bode') this.drawBode();
    else if (this.tab === 'iv') this.drawIv();
    else this.drawScope();
  }

  private graticule(g: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    g.lineWidth = 1;
    g.strokeStyle = GRID;
    for (let i = 1; i < HDIV; i++) {
      const x = Math.round((W * i) / HDIV) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let i = 1; i < VDIV; i++) {
      const y = Math.round((H * i) / VDIV) + 0.5;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    // Centre axes with five small ticks per division.
    g.strokeStyle = GRID_STRONG;
    const cx = Math.round(W / 2) + 0.5;
    const cy = Math.round(H / 2) + 0.5;
    g.beginPath();
    g.moveTo(0, cy);
    g.lineTo(W, cy);
    g.moveTo(cx, 0);
    g.lineTo(cx, H);
    for (let i = 0; i <= HDIV * 5; i++) {
      const x = (W * i) / (HDIV * 5);
      g.moveTo(x, cy - 3 * dpr);
      g.lineTo(x, cy + 3 * dpr);
    }
    for (let i = 0; i <= VDIV * 5; i++) {
      const y = (H * i) / (VDIV * 5);
      g.moveTo(cx - 3 * dpr, y);
      g.lineTo(cx + 3 * dpr, y);
    }
    g.stroke();
  }

  private drawScope(): void {
    const { g, W, H, dpr } = this.screen();
    this.graticule(g, W, H, dpr);
    const none = !this.probes[0] && !this.probes[1];
    this.empty(none ? t('noProbes') : null);
    const lever = this.el.querySelector<HTMLInputElement>('[data-lever]');
    const leverVal = this.el.querySelector<HTMLElement>('[data-lever-val]');
    if (none || this.count < 2) return;

    const span = this.timeDiv * HDIV;
    let tEnd: number;
    let trig: number | null = null;
    if (this.running) {
      trig = this.triggerTime();
      tEnd = trig !== null ? trig + span / 2 : this.latest();
      this.viewEnd = tEnd;
    } else tEnd = this.frozenEnd - this.lever * this.timeDiv;
    const tStart = tEnd - span;

    const max = this.maxLever();
    if (lever) {
      lever.max = max.toFixed(1);
      lever.value = String(Math.max(0, max - this.lever));
      lever.disabled = max <= 0;
    }
    if (leverVal) leverVal.textContent = this.lever > 0 ? `−${fmt(this.lever * this.timeDiv, 's')}` : t('now');

    // Samples on screen.
    const ts: number[] = [];
    const vs: number[][] = [[], []];
    for (let k = 0; k < this.count; k++) {
      const i = this.idx(k);
      const t0 = this.tBuf[i];
      if (t0 < tStart - this.timeDiv * 0.05 || t0 > tEnd + this.timeDiv * 0.05) continue;
      ts.push(t0);
      vs[0].push(this.vBuf[0][i]);
      vs[1].push(this.vBuf[1][i]);
    }
    const stats = vs.map((v) => measure(ts, v));
    const divH = H / VDIV;
    const scale: number[] = [];
    const offset: number[] = [];
    for (let c = 0; c < 2; c++) {
      if (!this.has[c]) continue;
      const st = stats[c];
      const base = this.ch[c].ac ? st.mean : 0;
      const peak = Math.max(Math.abs(st.max - base), Math.abs(st.min - base));
      const vdiv = this.ch[c].vdiv || niceDiv(peak / 3.6);
      scale[c] = vdiv;
      offset[c] = base;
      const y0 = H / 2 - this.ch[c].pos * divH;
      // Ground marker at the left edge.
      g.fillStyle = COLORS[c];
      g.beginPath();
      g.moveTo(0, y0 - 5 * dpr);
      g.lineTo(8 * dpr, y0);
      g.lineTo(0, y0 + 5 * dpr);
      g.fill();
      g.strokeStyle = COLORS[c];
      g.lineWidth = 2 * dpr;
      g.beginPath();
      ts.forEach((t0, k) => {
        const x = ((t0 - tStart) / span) * W;
        const y = y0 - ((vs[c][k] - base) / vdiv) * divH;
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }

    // Trigger mark at the top centre.
    if (trig !== null) {
      g.fillStyle = COLORS[this.trigSrc];
      const x = ((trig - tStart) / span) * W;
      g.beginPath();
      g.moveTo(x - 6 * dpr, 0);
      g.lineTo(x + 6 * dpr, 0);
      g.lineTo(x, 8 * dpr);
      g.fill();
    }

    // Cursors.
    if (this.cursorsOn) {
      g.setLineDash([5 * dpr, 4 * dpr]);
      g.strokeStyle = '#e48b5c';
      g.lineWidth = 1.5 * dpr;
      g.fillStyle = '#e48b5c';
      g.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
      this.cursors.forEach((c, i) => {
        const x = (c / HDIV) * W;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
        g.fillText(`T${i + 1}`, x + 4 * dpr, 14 * dpr);
      });
      g.setLineDash([]);
    }

    // Status text on the screen, as a real scope shows it.
    g.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
    g.textAlign = 'left';
    let tx = 8 * dpr;
    for (let c = 0; c < 2; c++) {
      if (!this.has[c]) continue;
      const label = `CH${c + 1} ${fmt(scale[c], 'V')}/div ${this.ch[c].ac ? 'AC' : 'DC'}`;
      g.fillStyle = COLORS[c];
      g.fillText(label, tx, H - 8 * dpr);
      tx += g.measureText(label).width + 16 * dpr;
    }
    g.fillStyle = TEXT;
    g.fillText(`${fmt(this.timeDiv, 's')}/div`, tx, H - 8 * dpr);
    g.textAlign = 'right';
    g.fillStyle = this.running ? '#5cc49a' : '#f07a6a';
    g.fillText(this.running ? (trig !== null ? 'RUN · TRIG’D' : 'RUN · AUTO') : 'STOP', W - 8 * dpr, 16 * dpr);
    g.textAlign = 'left';

    // Measurements under the screen.
    for (let c = 0; c < 2; c++) {
      const row = this.el.querySelector<HTMLElement>(`[data-meas="${c}"]`);
      if (!row) continue;
      if (!this.has[c]) {
        row.innerHTML = `<span class="ch ch${c + 1}">CH${c + 1}</span><em>${t('noProbe')}</em>`;
        continue;
      }
      const st = stats[c];
      const f = st.freq;
      const acRms = Math.sqrt(Math.max(0, st.rms * st.rms - st.mean * st.mean));
      row.innerHTML = `<span class="ch ch${c + 1}">CH${c + 1}</span>
        <span><i>f</i> ${f ? fmt(f, 'Hz') : '—'}</span>
        <span><i>T</i> ${f ? fmt(1 / f, 's') : '—'}</span>
        <span><i>Vp-p</i> ${fmt(st.max - st.min, 'V')}</span>
        <span><i>Vmax</i> ${fmt(st.max, 'V')}</span>
        <span><i>Vmin</i> ${fmt(st.min, 'V')}</span>
        <span><i>Vrms</i> ${fmt(this.ch[c].ac ? acRms : st.rms, 'V')}</span>
        <span><i>Vavg</i> ${fmt(st.mean, 'V')}</span>`;
    }
    const cur = this.el.querySelector<HTMLElement>('[data-meas="c"]');
    if (cur && this.cursorsOn) {
      const tc = this.cursors.map((c) => tStart + (c / HDIV) * span);
      const dt = Math.abs(tc[1] - tc[0]);
      const at = (c: number, tt: number) => {
        let best = 0;
        let bd = Infinity;
        ts.forEach((t0, k) => {
          const d = Math.abs(t0 - tt);
          if (d < bd) {
            bd = d;
            best = vs[c][k];
          }
        });
        return best;
      };
      const dv = [0, 1].filter((c) => this.has[c]).map((c) => `ΔV${c + 1} ${fmt(at(c, tc[1]) - at(c, tc[0]), 'V')}`);
      cur.innerHTML = `<span class="ch curs">${t('cursors')}</span><span><i>Δt</i> ${fmt(dt, 's')}</span><span><i>1/Δt</i> ${dt > 0 ? fmt(1 / dt, 'Hz') : '—'}</span>${dv.map((s) => `<span>${s}</span>`).join('')}`;
    }
  }

  // ------------------------------------------------------------ Bode plotter

  /** Re-run the frequency sweep when the circuit changed, and now and then while it runs. */
  private updateBode(): void {
    const now = performance.now();
    if (!this.bodeDirty && now - this.bodeAt < 1000) return;
    this.bodeDirty = false;
    this.bodeAt = now;
    const app = this.app;
    const bp = app.doc.parts.find((p) => p.type === 'bode');
    const src = app.doc.parts.find((p) => p.type === 'funcgen' || p.type === 'ac');
    if (!bp || !src) {
      this.bode = [];
      this.cutoffText = '';
      return;
    }
    const nodes = app.engine.net.pinNodes.get(bp.id)!;
    const fmin = Math.max(1e-3, Number(bp.params.fmin) || 1);
    const fmax = Math.max(fmin * 10, Number(bp.params.fmax) || 1e5);
    const freqs = Array.from({ length: 160 }, (_, i) => fmin * Math.pow(fmax / fmin, i / 159));
    this.bode = app.engine.acSweep(src.id, nodes[0], nodes[1], freqs);
    this.cutoffText = cutoffs(this.bode)
      .map((f) => fmt(f, 'Hz'))
      .join(' ، ');
  }

  private drawBode(): void {
    const { g, W, H, dpr } = this.screen();
    const pts = this.bode;
    const bp = this.app.doc.parts.find((p) => p.type === 'bode');
    this.empty(pts.length < 2 ? t('bodeNoSource') : null);
    const fcEl = document.getElementById('bode-fc');
    if (fcEl) fcEl.textContent = this.cutoffText ? `${t('cutoff')}: ${this.cutoffText}` : '';
    if (!bp || pts.length < 2) return;

    const L = 46 * dpr;
    const R = W - 46 * dpr;
    const T = 10 * dpr;
    const B = H - 22 * dpr;
    const f0 = pts[0].f;
    const f1 = pts[pts.length - 1].f;
    const xf = (f: number) => L + ((Math.log10(f) - Math.log10(f0)) / (Math.log10(f1) - Math.log10(f0))) * (R - L);
    const dbs = pts.map((p) => p.db);
    const top = Math.ceil(Math.max(...dbs) / 10) * 10 + (Math.max(...dbs) % 10 === 0 ? 10 : 0);
    let bottom = Math.max(Math.floor(Math.min(...dbs) / 10) * 10, top - 80);
    if (top - bottom < 30) bottom = top - 30;
    const yDb = (d: number) => T + ((top - Math.max(bottom, Math.min(top, d))) / (top - bottom)) * (B - T);
    const yPh = (ph: number) => T + ((180 - ph) / 360) * (B - T);

    g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    g.lineWidth = 1;
    g.strokeStyle = GRID;
    g.fillStyle = TEXT;
    g.textAlign = 'center';
    for (let e = Math.ceil(Math.log10(f0)); e <= Math.floor(Math.log10(f1)); e++) {
      const x = Math.round(xf(10 ** e)) + 0.5;
      g.beginPath();
      g.moveTo(x, T);
      g.lineTo(x, B);
      g.stroke();
      g.fillText(fmt(10 ** e, 'Hz'), x, H - 6 * dpr);
    }
    g.textAlign = 'right';
    for (let d = bottom; d <= top; d += 10) {
      const y = Math.round(yDb(d)) + 0.5;
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(R, y);
      g.stroke();
      g.fillStyle = COLORS[0];
      g.fillText(`${d} dB`, L - 4 * dpr, y + 4 * dpr);
    }
    g.textAlign = 'left';
    g.fillStyle = COLORS[1];
    for (const ph of [180, 90, 0, -90, -180]) g.fillText(`${ph}°`, R + 4 * dpr, yPh(ph) + 4 * dpr);

    const curve = (color: string, y: (p: BodePoint) => number, dash: number[]) => {
      g.strokeStyle = color;
      g.lineWidth = 2 * dpr;
      g.setLineDash(dash);
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(xf(p.f), y(p)) : g.moveTo(xf(p.f), y(p))));
      g.stroke();
      g.setLineDash([]);
    };
    curve(COLORS[1], (p) => yPh(p.phase), [6 * dpr, 4 * dpr]);
    curve(COLORS[0], (p) => yDb(p.db), []);

    g.strokeStyle = '#e48b5c';
    g.lineWidth = 1.5 * dpr;
    g.setLineDash([4 * dpr, 3 * dpr]);
    for (const f of cutoffs(pts)) {
      const x = xf(f);
      g.beginPath();
      g.moveTo(x, T);
      g.lineTo(x, B);
      g.stroke();
    }
    g.setLineDash([]);

    const read = document.getElementById('bode-read');
    if (this.hoverX !== null && this.hoverX >= L && this.hoverX <= R) {
      const f = 10 ** (Math.log10(f0) + ((this.hoverX - L) / (R - L)) * (Math.log10(f1) - Math.log10(f0)));
      const p = pts.reduce((a, b) => (Math.abs(Math.log(b.f / f)) < Math.abs(Math.log(a.f / f)) ? b : a));
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xf(p.f), T);
      g.lineTo(xf(p.f), B);
      g.stroke();
      if (read) read.textContent = `${fmt(p.f, 'Hz')}  ${p.db.toFixed(1)} dB  ${p.phase.toFixed(0)}°`;
    } else if (read) read.textContent = '';
  }

  // ------------------------------------------------------------ curve tracer

  private drawIv(): void {
    const { g, W, H, dpr } = this.screen();
    const iv = this.iv;
    this.empty(null);
    if (!iv) return;
    const { plot } = iv;
    const all = plot.curves.flatMap((c) => c.pts);
    const xs = all.map((p) => p.v);
    const ys = all.map((p) => p.i);
    const x0 = Math.min(0, ...xs);
    const x1 = Math.max(0, ...xs);
    // Diodes: clip the forward current so the knee stays visible.
    const y1 = Math.max(1e-9, Math.min(Math.max(...ys), plot.curves.length === 1 ? 0.1 : Infinity)) * 1.12;
    const y0 = Math.min(0, Math.max(Math.min(...ys), -y1));
    const L = 58 * dpr;
    const R = W - 16 * dpr;
    const T = 12 * dpr;
    const B = H - 24 * dpr;
    const X = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (R - L);
    const Y = (i: number) => B - ((Math.max(y0, Math.min(y1, i)) - y0) / (y1 - y0 || 1)) * (B - T);
    g.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    g.lineWidth = 1;
    const xStep = niceStep((x1 - x0) / 8);
    const yStep = niceStep((y1 - y0) / 6);
    g.textAlign = 'center';
    for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1 + 1e-12; v += xStep) {
      g.strokeStyle = Math.abs(v) < 1e-12 ? GRID_STRONG : GRID;
      g.beginPath();
      g.moveTo(X(v), T);
      g.lineTo(X(v), B);
      g.stroke();
      g.fillStyle = TEXT;
      g.fillText(fmt(v, 'V'), X(v), H - 6 * dpr);
    }
    g.textAlign = 'right';
    for (let i = Math.ceil(y0 / yStep) * yStep; i <= y1 + 1e-15; i += yStep) {
      g.strokeStyle = Math.abs(i) < 1e-15 ? GRID_STRONG : GRID;
      g.beginPath();
      g.moveTo(L, Y(i));
      g.lineTo(R, Y(i));
      g.stroke();
      g.fillStyle = TEXT;
      g.fillText(fmt(i, 'A'), L - 4 * dpr, Y(i) + 4 * dpr);
    }
    const palette = ['#f5c542', '#4fc3f7', '#5cc49a', '#e48b5c', '#c792ea'];
    plot.curves.forEach((c, k) => {
      g.strokeStyle = palette[k % palette.length];
      g.lineWidth = 2 * dpr;
      g.beginPath();
      c.pts.forEach((p, i) => (i ? g.lineTo(X(p.v), Y(p.i)) : g.moveTo(X(p.v), Y(p.i))));
      g.stroke();
      if (c.label) {
        const last = c.pts[c.pts.length - 1];
        g.fillStyle = palette[k % palette.length];
        g.textAlign = 'right';
        g.fillText(c.label, R - 4 * dpr, Y(last.i) - 5 * dpr);
      }
    });
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.fillText(`${plot.yLabel} ↑   ${plot.xLabel} →`, L + 6 * dpr, T + 12 * dpr);
    const read = document.getElementById('iv-read');
    if (read && this.hoverX !== null && this.hoverX >= L && this.hoverX <= R) {
      const v = x0 + ((this.hoverX - L) / (R - L)) * (x1 - x0);
      const c = plot.curves[0];
      const p = c.pts.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));
      read.textContent = `${plot.xLabel} ${fmt(p.v, 'V')}  ${plot.yLabel} ${fmt(p.i, 'A')}`;
    } else if (read) read.textContent = '';
  }
}

function niceStep(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

/** Frequencies where the gain is 3 dB below its peak (one for low/high-pass, two for band filters). */
export function cutoffs(pts: BodePoint[]): number[] {
  if (pts.length < 2) return [];
  const peak = Math.max(...pts.map((p) => p.db));
  const level = peak - 3;
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if ((a.db - level) * (b.db - level) < 0) {
      const k = (level - a.db) / (b.db - a.db);
      out.push(10 ** (Math.log10(a.f) + k * (Math.log10(b.f) - Math.log10(a.f))));
    }
  }
  return out.slice(0, 2);
}
