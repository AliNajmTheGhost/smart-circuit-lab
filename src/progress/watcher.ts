/**
 * Notices achievements while the student works: looks at the running circuit twice a second
 * and listens for lessons finished, examples opened and parts burned.
 */
import { CHALLENGES } from '../challenges/challenges';
import { LESSONS } from '../lessons/lessons';
import type { App } from '../ui/app';
import type { ProgressStore } from './store';

const CHECK_MS = 500;
/** Parts whose live values can earn a badge. */
const WATCHED = new Set(['lamp', 'led', 'irtx', 'speaker', 'buzzer', 'multimeter', 'voltmeter', 'ammeter', 'timer555', 'counter']);

export class ProgressWatcher {
  private lastCheck = 0;
  /** The circuit was started from an empty board, so it is the student's own design. */
  private ownDesign = false;
  private timerFlips = 0;
  private lastTimerOut = new Map<string, number>();

  constructor(
    private readonly app: App,
    private readonly store: ProgressStore,
  ) {}

  /** Called every frame; does its work at most twice a second. */
  frame(now: number): void {
    if (now - this.lastCheck < CHECK_MS) return;
    this.lastCheck = now;
    const app = this.app;
    const e = app.engine;
    if (app.doc.parts.length === 0) this.ownDesign = true;
    if (!e || !app.running || e.failure) return;
    let current = false;
    for (const p of app.doc.parts) {
      const d = e.byId.get(p.id);
      if (!d || app.broken.has(p.id)) continue;
      if (Math.abs(d.cur[0] ?? 0) > 1e-3) current = true;
      if (WATCHED.has(p.type)) this.checkPart(p.id, p.type, d.extra());
    }
    if (app.scopeOpen && app.doc.parts.some((p) => p.type === 'probe') && e.t > 0.02) this.store.unlock('scope');
    const real = app.doc.parts.filter((p) => p.type !== 'ground' && p.type !== 'probe').length;
    const errors = app.notes.some((n) => n.level === 'error' || n.level === 'burn');
    if (this.ownDesign && real >= 5 && current && !errors) this.store.unlock('builder');
  }

  private checkPart(id: string, type: string, x: Record<string, number>): void {
    switch (type) {
      case 'lamp':
      case 'led':
      case 'irtx':
        if ((x.brightness ?? 0) > 0.3) this.store.unlock('first-light');
        break;
      case 'speaker':
        if ((x.loud ?? 0) > 0.05 && (x.f ?? 0) >= 20) this.store.unlock('first-sound');
        break;
      case 'buzzer':
        if ((x.loud ?? 0) > 0.2) this.store.unlock('first-sound');
        break;
      case 'multimeter':
      case 'voltmeter':
      case 'ammeter':
        if (Number.isFinite(x.reading) && Math.abs(x.reading ?? 0) > 1e-3) this.store.unlock('meter');
        break;
      case 'timer555': {
        const prev = this.lastTimerOut.get(id);
        if (prev !== undefined && prev !== x.out) this.timerFlips++;
        this.lastTimerOut.set(id, x.out ?? 0);
        if (this.timerFlips >= 3) this.store.unlock('oscillator');
        break;
      }
      case 'counter':
        if ((x.count ?? 0) >= 5) this.store.unlock('counter');
        break;
    }
  }

  /** A circuit from the examples or lessons replaced the board: not the student's own design. */
  loadedReadyMade(): void {
    this.ownDesign = false;
  }

  partBurned(): void {
    this.store.unlock('first-burn');
  }

  exampleOpened(id: string): void {
    this.loadedReadyMade();
    this.store.exampleOpened(id);
    if (this.store.examplesOpened() >= 10) this.store.unlock('explorer');
  }

  challengeFinished(id: string, stars: number): void {
    this.loadedReadyMade();
    this.store.challengeDone(id, stars);
    this.store.unlock('repair-1');
    if (stars === 3) this.store.unlock('repair-ace');
    const done = this.store.challengesDone();
    if (CHALLENGES.every((c) => done.includes(c.id))) this.store.unlock('repair-all');
  }

  lessonStarted(): void {
    this.loadedReadyMade();
  }

  lessonFinished(id: string): void {
    this.store.lessonDone(id);
    const done = this.store.lessonsDone();
    this.store.unlock('lesson-1');
    if (done.length >= 5) this.store.unlock('lesson-5');
    if (LESSONS.every((l) => done.includes(l.id))) this.store.unlock('lesson-all');
  }
}
