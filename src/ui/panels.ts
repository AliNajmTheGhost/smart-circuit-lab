import type { App } from './app';
import type { Board } from './board';
import { DoctorPanel } from './doctor';
import { popSound } from './dom';
import { Inspector } from './inspector';
import { LessonRunner } from './lesson';
import { Palette } from './palette';
import { Scope } from './scope';
import { Toolbar } from './toolbar';
import { showWelcome } from './welcome';

/** Puts the panels together and routes keyboard shortcuts and per-frame updates to them. */
export class Panels {
  readonly scope: Scope;
  readonly toolbar: Toolbar;
  private inspector: Inspector;
  private doctor: DoctorPanel;
  private palette: Palette;
  private lesson: LessonRunner;
  /** True when the board started with a circuit restored from last time. */
  restored = false;

  constructor(
    private app: App,
    private board: Board,
  ) {
    this.scope = new Scope(app);
    this.lesson = new LessonRunner(app, board, this.scope);
    this.palette = new Palette(app);
    this.inspector = new Inspector(app, board, this.scope);
    this.doctor = new DoctorPanel(app);
    this.toolbar = new Toolbar(app, board, this.scope, {
      openLessons: () => this.lesson.chooser(),
      openWelcome: () => this.welcome(),
      rebuild: () => this.rebuild(),
    });
    // Opening or closing the instrument panel changes the board's size: re-fit the circuit to it.
    let scopeWasOpen = app.scopeOpen;
    app.on('settings', () => {
      this.scope.sync();
      if (app.scopeOpen !== scopeWasOpen) {
        scopeWasOpen = app.scopeOpen;
        requestAnimationFrame(() => board.fit());
      }
    });
    app.on('frame', () => this.frame());
    app.onDamage = () => popSound();
    window.addEventListener('keydown', (e) => this.keys(e));
  }

  welcome(): void {
    showWelcome({
      newCircuit: () => void this.toolbar.act('new', document.body),
      resume: this.restored ? () => this.board.fit() : undefined,
      examples: () => this.toolbar.examples(),
      lessons: () => this.lesson.chooser(),
    });
  }

  private rebuild(): void {
    this.toolbar.build();
    this.palette.build();
    this.inspector.render();
    this.doctor.render();
    this.scope.build();
    this.lesson.render();
  }

  private frame(): void {
    this.inspector.tick();
    this.doctor.tick();
    this.toolbar.tick();
    this.scope.draw();
    this.lesson.check();
  }

  private keys(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || !document.getElementById('modal')!.hidden) return;
    const app = this.app;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    } else if (ctrl && k === 'y') {
      e.preventDefault();
      app.redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      app.exportFile();
    } else if (ctrl && k === 'a') {
      e.preventDefault();
      app.selectAll();
    } else if (ctrl && k === 'd') {
      e.preventDefault();
      this.board.duplicateSelected();
    } else if (!ctrl && (k === 'r' || k === 'ق')) this.board.rotateSelected();
    else if (k === 'delete' || k === 'backspace') this.board.deleteSelected();
    else if (k === 'escape') {
      if (!this.board.cancel()) app.select(null);
    } else if (k === ' ') {
      e.preventDefault();
      app.setRunning(!app.running);
    }
  }
}
