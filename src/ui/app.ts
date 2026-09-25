import { getLang, message, setLang, t, type Lang } from '../i18n';
import { cloneDoc, normalizeWires, topologyKey } from '../model/docops';
import { defOf } from '../model/library';
import { emptyDoc, type CircuitDoc, type Part } from '../model/types';
import { staticChecks, type DoctorNote } from '../sim/doctor';
import { Engine, type PartIssue } from '../sim/engine';
import type { SymbolStd } from './symbols';

export type Selection = { kind: 'part' | 'wire'; id: string } | null;
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
const MAX_HISTORY = 200;

export class App {
  doc: CircuitDoc = emptyDoc();
  selection: Selection = null;
  placing: string | null = null;
  std: SymbolStd = 'ansi';
  running = true;
  speed = 1;
  showVolt = true;
  showCurrent = true;
  scopeOpen = false;
  engine!: Engine;
  /** Damaged parts stay damaged until the student replaces them. */
  broken = new Map<string, PartIssue>();
  notes: Note[] = [];
  /** Called after each simulated step, for the oscilloscope. */
  stepHooks: ((e: Engine) => void)[] = [];

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private topo = '';
  private listeners = new Map<EventName, Set<() => void>>();
  private staticNotes: DoctorNote[] = [];
  private lastFrame = 0;
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
    this.selection = null;
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
    const s = this.selection;
    if (s && !(s.kind === 'part' ? this.part(s.id) : this.doc.wires.find((w) => w.id === s.id))) {
      this.selection = null;
      this.emit('select');
    }
  }

  private afterChange(): void {
    for (const id of [...this.broken.keys()]) if (!this.part(id)) this.broken.delete(id);
    this.syncEngine();
    this.save();
    this.emit('doc');
  }

  select(sel: Selection): void {
    this.selection = sel;
    this.emit('select');
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

  private syncEngine(): void {
    const key = topologyKey(this.doc);
    if (key !== this.topo || !this.engine) {
      const state = this.engine?.exportState();
      const t0 = this.engine?.t ?? 0;
      this.topo = key;
      this.engine = new Engine(this.doc, 1e-5, new Set(this.broken.keys()));
      if (state) this.engine.importState(state, t0);
    } else {
      this.engine.syncParts(this.doc);
    }
    this.staticNotes = staticChecks(this.doc, this.engine.net);
    this.refreshNotes();
  }

  private rebuild(): void {
    this.topo = '';
    this.syncEngine();
  }

  /** Start again from t = 0: capacitors empty, damaged parts replaced. */
  restart(): void {
    this.broken.clear();
    this.engine = new Engine(this.doc, 1e-5);
    this.topo = topologyKey(this.doc);
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
      while (this.stepDebt >= 1) {
        const damaged = this.engine.step();
        this.stepDebt -= 1;
        for (const d of damaged) {
          this.broken.set(d.part, d);
          newDamage = true;
        }
        for (const h of this.stepHooks) h(this.engine);
        if (performance.now() - start > FRAME_BUDGET_MS) {
          this.stepDebt = Math.min(this.stepDebt, 1);
          break;
        }
      }
      if (newDamage) {
        this.onDamage?.();
        this.emit('doc');
      }
    }
    this.refreshNotes();
    this.emit('frame');
  }

  onDamage?: () => void;

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

  setOption<K extends 'std' | 'speed' | 'showVolt' | 'showCurrent' | 'scopeOpen'>(k: K, v: App[K]): void {
    (this as App)[k] = v;
    this.saveSettings();
    this.emit('settings');
    if (k === 'std') this.emit('doc');
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(
        STORE_SETTINGS,
        JSON.stringify({ std: this.std, speed: this.speed, showVolt: this.showVolt, showCurrent: this.showCurrent, lang: getLang(), scopeOpen: this.scopeOpen }),
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
    if (typeof s.scopeOpen === 'boolean') this.scopeOpen = s.scopeOpen;
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
      const d = JSON.parse(raw) as CircuitDoc;
      if (!isDoc(d) || d.parts.length === 0) return false;
      this.load(d, false);
      return true;
    } catch {
      return false;
    }
  }

  exportFile(): void {
    const blob = new Blob([JSON.stringify(this.doc, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.doc.title || 'circuit'}.nabd`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importFile(file: File): Promise<boolean> {
    try {
      const d = JSON.parse(await file.text());
      if (!isDoc(d)) return false;
      for (const p of d.parts) defOf(p.type);
      this.load(d);
      return true;
    } catch {
      return false;
    }
  }
}

function isDoc(d: unknown): d is CircuitDoc {
  const o = d as CircuitDoc;
  return !!o && o.version === 1 && Array.isArray(o.parts) && Array.isArray(o.wires);
}

export { t };
