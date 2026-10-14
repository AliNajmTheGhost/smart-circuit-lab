import { getLang, message, setLang, t, type Lang } from '../i18n';
import { cloneDoc, normalizeWires, topologyKey } from '../model/docops';
import { sanitizeDoc } from '../model/sanitize';
import { defOf } from '../model/library';
import { emptyDoc, type CircuitDoc, type Part } from '../model/types';
import type { DoctorNote } from '../sim/doctor';
import type { PartIssue } from '../sim/engine';
import { WasmEngine as Engine } from '../sim/wasm/engine';
import { BRAND, VERSION } from '../brand';
import { saveCircuitFile } from '../platform/files';
import type { SymbolStd } from './symbols';

export type Selection = { kind: 'part' | 'wire'; id: string } | null;
export type Theme = 'system' | 'light' | 'dark';
/** How much of a circuit file could be opened. */
export type ImportResult = 'ok' | 'partly' | 'bad';
type EventName = 'doc' | 'select' | 'frame' | 'mode' | 'settings' | 'notes';

export interface Note extends DoctorNote {
  text: string;
}

/** Simulated time per real second at each speed. */
export const SPEEDS = [
  { key: 'slow', simPerSec: 0.02 },
  { key: 'normal', simPerSec: 0.1 },
  { key: 'fast', simPerSec: 1 },
];

const STORE_DOC = 'nabd.doc';
const STORE_SETTINGS = 'nabd.settings';
const FRAME_BUDGET_MS = 10;
/**
 * Phones and tablets: the simulation gets a smaller share of each frame and the board is redrawn
 * at most about 30 times a second, so touch and scrolling stay smooth on slow lab phones.
 */
const LOW_POWER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const SIM_BUDGET_MS = LOW_POWER ? 6 : FRAME_BUDGET_MS;
const DRAW_EVERY_MS = LOW_POWER ? 30 : 0;
/** Advice (e.g. "this resistor is getting hot") is checked a few times a second, not every frame. */
const NOTES_EVERY_MS = 250;
/** Steps per call into the simulation core; small enough to keep the frame budget. */
const BATCH = 200;
const MAX_HISTORY = 200;

export class App {
  doc: CircuitDoc = emptyDoc();
  /** Everything currently selected. The inspector shows details when exactly one thing is selected. */
  readonly sel = { parts: new Set<string>(), wires: new Set<string>() };
  placing: string | null = null;
  std: SymbolStd = 'ansi';
  running = true;
  speed = 1;
  showVolt = true;
  showCurrent = true;
  /** Speakers, buzzers, clicks and crackles. */
  sound = true;
  scopeOpen = false;
  /** 'system' follows the device; light and dark are explicit choices. */
  theme: Theme = 'system';
  engine!: Engine;
  /** Damaged parts stay damaged until the student replaces them. */
  broken = new Map<string, PartIssue>();
  notes: Note[] = [];
  /** Called after each batch of simulated steps, for the oscilloscope. */
  stepHooks: ((e: Engine) => void)[] = [];

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private topo = '';
  private listeners = new Map<EventName, Set<() => void>>();
  private staticNotes: DoctorNote[] = [];
  private lastFrame = 0;
  private lastDraw = 0;
  private lastNotes = 0;
  private stepDebt = 0;

  constructor() {
    this.loadSettings();
    this.syncEngine();
  }

  on(ev: EventName, fn: () => void): void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
  }

  emit(ev: EventName): void {
    this.listeners.get(ev)?.forEach((fn) => fn());
  }

  part(id: string): Part | undefined {
    return this.doc.parts.find((p) => p.id === id);
  }

  // ------------------------------------------------------------ editing

  /** Change the document. `history: false` is for switches and knobs moved while running. */
  commit(mutate: (d: CircuitDoc) => void, opts: { history?: boolean } = {}): void {
    if (opts.history !== false) {
      this.undoStack.push(JSON.stringify(this.doc));
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
    }
    mutate(this.doc);
    normalizeWires(this.doc);
    this.afterChange();
  }

  /** Replace the whole document (open, example, lesson). */
  load(doc: CircuitDoc, keepHistory = true): void {
    if (keepHistory) {
      this.undoStack.push(JSON.stringify(this.doc));
      this.redoStack = [];
    }
    this.doc = cloneDoc(doc);
    normalizeWires(this.doc);
    this.broken.clear();
    this.sel.parts.clear();
    this.sel.wires.clear();
    this.topo = '';
    this.afterChange();
    this.emit('select');
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(prev);
    this.dropStaleSelection();
    this.afterChange();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(next);
    this.dropStaleSelection();
    this.afterChange();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private dropStaleSelection(): void {
    let changed = false;
    for (const id of this.sel.parts)
      if (!this.part(id)) {
        this.sel.parts.delete(id);
        changed = true;
      }
    const wires = new Set(this.doc.wires.map((w) => w.id));
    for (const id of this.sel.wires)
      if (!wires.has(id)) {
        this.sel.wires.delete(id);
        changed = true;
      }
    if (changed) this.emit('select');
  }

  private afterChange(): void {
    for (const id of [...this.broken.keys()]) if (!this.part(id)) this.broken.delete(id);
    this.syncEngine();
    this.save();
    this.emit('doc');
  }

  /** The single selected item, or null when nothing or several things are selected. */
  get selection(): Selection {
    const { parts, wires } = this.sel;
    if (parts.size + wires.size !== 1) return null;
    return parts.size ? { kind: 'part', id: [...parts][0] } : { kind: 'wire', id: [...wires][0] };
  }

  get selCount(): number {
    return this.sel.parts.size + this.sel.wires.size;
  }

  isSelected(kind: 'part' | 'wire', id: string): boolean {
    return (kind === 'part' ? this.sel.parts : this.sel.wires).has(id);
  }

  select(s: Selection): void {
    this.sel.parts.clear();
    this.sel.wires.clear();
    if (s) (s.kind === 'part' ? this.sel.parts : this.sel.wires).add(s.id);
    this.emit('select');
  }

  /** Select several items; with `add` they join the current selection. */
  selectMany(parts: string[], wires: string[], add = false): void {
    if (!add) {
      this.sel.parts.clear();
      this.sel.wires.clear();
    }
    parts.forEach((id) => this.sel.parts.add(id));
    wires.forEach((id) => this.sel.wires.add(id));
    this.emit('select');
  }

  toggleSelected(kind: 'part' | 'wire', id: string): void {
    const set = kind === 'part' ? this.sel.parts : this.sel.wires;
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.emit('select');
  }

  selectAll(): void {
    this.selectMany(
      this.doc.parts.map((p) => p.id),
      this.doc.wires.map((w) => w.id),
    );
  }

  startPlacing(type: string | null): void {
    this.placing = type;
    this.emit('mode');
  }

  /** Changing a value of a damaged part means a new part was fitted. */
  setParam(id: string, key: string, value: number | string, history = true): void {
    this.commit(
      (d) => {
        const p = d.parts.find((q) => q.id === id);
        if (p) p.params[key] = value;
      },
      { history },
    );
    if (history && this.broken.delete(id)) this.rebuild();
  }

  repair(id?: string): void {
    if (id) this.broken.delete(id);
    else this.broken.clear();
    this.rebuild();
    this.emit('doc');
  }

  // ------------------------------------------------------------ simulation

  /**
   * Time step: 10 µs normally, smaller when a source runs fast (at least 50 steps per cycle),
   * so a 5 kHz carrier still looks like a sine wave.
   */
  private chooseDt(): number {
    let fmax = 0;
    for (const p of this.doc.parts) {
      if (p.type !== 'ac' && p.type !== 'funcgen') continue;
      const f = Number(p.params.f) || 0;
      const extra = p.params.wave === 'fm' ? Number(p.params.dev) || 0 : 0;
      fmax = Math.max(fmax, f + extra);
    }
    if (fmax <= 0) return 1e-5;
    return Math.min(1e-5, Math.max(2e-7, 1 / (fmax * 50)));
  }

  private syncEngine(): void {
    const dt = this.chooseDt();
    const key = `${topologyKey(this.doc)}|${dt}`;
    if (key !== this.topo || !this.engine) {
      // The new core is built first and the old one is let go only once it exists. A circuit the
      // core refuses would otherwise leave the program holding a core it has already freed, and
      // every later step — the clock, the readings, opening another circuit — would fail.
      const next = new Engine(this.doc, dt, new Set(this.broken.keys()));
      const old = this.engine;
      try {
        const state = old?.exportState();
        if (state) next.importState(state, old!.t);
      } catch {
        /* the previous run's state does not fit the new circuit; start it from zero */
      }
      this.topo = key;
      this.engine = next;
      old?.dispose();
    } else {
      this.engine.syncParts(this.doc);
    }
    this.staticNotes = this.engine.staticChecks();
    this.refreshNotes();
  }

  private rebuild(): void {
    this.topo = '';
    this.syncEngine();
  }

  /** Start again from t = 0: capacitors empty, damaged parts replaced. */
  restart(): void {
    this.broken.clear();
    const dt = this.chooseDt();
    this.engine?.dispose();
    this.engine = new Engine(this.doc, dt);
    this.topo = `${topologyKey(this.doc)}|${dt}`;
    this.stepDebt = 0;
    this.stepHooks.forEach((h) => h(this.engine));
    this.refreshNotes();
    this.emit('doc');
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.emit('settings');
  }

  tick(now: number): void {
    const dtReal = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.5) : 0;
    this.lastFrame = now;
    if (this.running && !this.engine.failure) {
      this.stepDebt += (dtReal * SPEEDS[this.speed].simPerSec) / this.engine.dt;
      const start = performance.now();
      let newDamage = false;
      // Steps run in batches: one call into the core per batch instead of per step.
      while (this.stepDebt >= 1) {
        const k = Math.min(Math.floor(this.stepDebt), BATCH);
        const damaged = this.engine.run(k);
        this.stepDebt -= k;
        for (const d of damaged) {
          this.broken.set(d.part, d);
          newDamage = true;
        }
        for (const h of this.stepHooks) h(this.engine);
        if (performance.now() - start > SIM_BUDGET_MS) {
          this.stepDebt = Math.min(this.stepDebt, 1);
          break;
        }
      }
      if (newDamage) {
        this.onDamage?.();
        this.emit('doc');
      }
    }
    if (now - this.lastNotes >= NOTES_EVERY_MS) {
      this.lastNotes = now;
      this.refreshNotes();
    }
    if (now - this.lastDraw < DRAW_EVERY_MS) return;
    this.lastDraw = now;
    this.emit('frame');
  }

  onDamage?: () => void;
  /** A switch, push button or logic switch was flipped by the student. */
  onSwitch?: () => void;

  private notesKey = '';
  private refreshNotes(): void {
    const all: DoctorNote[] = [];
    if (this.engine?.failure) all.push({ level: 'error', key: this.engine.failure, parts: [] });
    for (const [id, b] of this.broken) all.push({ level: 'burn', key: b.key, vars: b.vars, parts: [id] });
    all.push(...this.staticNotes);
    if (this.running) for (const a of this.engine?.advice() ?? []) all.push({ level: a.level === 'burn' ? 'warn' : a.level, key: a.key, vars: a.vars, parts: [a.part] });
    const key = all.map((n) => `${n.key}:${n.parts.join(',')}`).join('|') + getLang();
    // Numbers in advice change every frame; only rebuild the list when the set of problems changes,
    // but keep the latest text for display.
    this.notes = all.map((n) => ({ ...n, text: this.noteText(n) }));
    if (key !== this.notesKey) {
      this.notesKey = key;
      this.emit('notes');
    }
  }

  private noteText(n: DoctorNote): string {
    const p = n.parts[0] ? this.part(n.parts[0]) : undefined;
    const vars = { ...(n.vars ?? {}) };
    if (p && n.key === 'doc.openPin') {
      const pin = defOf(p.type).pins[Number(vars.pin)];
      vars.pin = getLang() === 'ar' ? pin.ar : pin.en;
    }
    return message(n.key, p?.label ?? '', vars);
  }

  // ------------------------------------------------------------ settings & storage

  setLanguage(l: Lang): void {
    setLang(l);
    this.saveSettings();
    this.notesKey = '';
    this.refreshNotes();
    this.emit('settings');
    this.emit('doc');
    this.emit('select');
  }

  setOption<K extends 'std' | 'speed' | 'showVolt' | 'showCurrent' | 'scopeOpen' | 'theme' | 'sound'>(k: K, v: App[K]): void {
    (this as App)[k] = v;
    if (k === 'theme') applyTheme(this.theme);
    this.saveSettings();
    this.emit('settings');
    if (k === 'std') this.emit('doc');
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(
        STORE_SETTINGS,
        JSON.stringify({
          std: this.std,
          speed: this.speed,
          showVolt: this.showVolt,
          showCurrent: this.showCurrent,
          sound: this.sound,
          lang: getLang(),
          scopeOpen: this.scopeOpen,
          theme: this.theme,
        }),
      );
    } catch {
      /* storage may be unavailable; settings just won't persist */
    }
  }

  private loadSettings(): void {
    let s: Record<string, unknown> = {};
    try {
      s = JSON.parse(localStorage.getItem(STORE_SETTINGS) ?? '{}');
    } catch {
      s = {};
    }
    if (s.std === 'iec' || s.std === 'ansi') this.std = s.std;
    if (typeof s.speed === 'number' && SPEEDS[s.speed]) this.speed = s.speed;
    if (typeof s.showVolt === 'boolean') this.showVolt = s.showVolt;
    if (typeof s.showCurrent === 'boolean') this.showCurrent = s.showCurrent;
    if (typeof s.sound === 'boolean') this.sound = s.sound;
    if (typeof s.scopeOpen === 'boolean') this.scopeOpen = s.scopeOpen;
    if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'system') this.theme = s.theme;
    applyTheme(this.theme);
    setLang(s.lang === 'en' ? 'en' : 'ar');
  }

  save(): void {
    try {
      localStorage.setItem(STORE_DOC, JSON.stringify(this.doc));
    } catch {
      /* ignore */
    }
  }

  restore(): boolean {
    try {
      const raw = localStorage.getItem(STORE_DOC);
      if (!raw) return false;
      // Storage is checked as strictly as a file: another page on the same origin, or a circuit
      // left behind by an older version, must not be able to put anything odd on the board.
      const s = sanitizeDoc(JSON.parse(raw));
      if (!s || s.doc.parts.length === 0) return false;
      // A repair challenge left half-done would come back with its fault but without its card.
      for (const p of s.doc.parts) delete p.params._fault;
      this.load(s.doc, false);
      return true;
    } catch {
      return false;
    }
  }

  /** Save the circuit as a .nabd file. Resolves false if the student cancelled. */
  exportFile(): Promise<boolean> {
    // The file says which program made it; the circuit format itself is unchanged.
    const file = { ...this.doc, generator: `${BRAND.en} ${VERSION}` };
    return saveCircuitFile(this.doc.title || 'circuit', JSON.stringify(file, null, 1));
  }

  /**
   * Open a circuit from the text of a .sclab file: 'ok', 'partly' when some of the file could
   * not be used and was left out, or 'bad' when it is not a circuit at all.
   */
  async importText(text: string): Promise<ImportResult> {
    try {
      const s = sanitizeDoc(JSON.parse(text));
      if (!s) return 'bad';
      this.load(s.doc);
      return s.dropped > 0 ? 'partly' : 'ok';
    } catch {
      return 'bad';
    }
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export { t };
