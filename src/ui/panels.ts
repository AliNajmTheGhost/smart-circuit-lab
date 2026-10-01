import type { App } from './app';
import type { Board } from './board';
import { DoctorPanel } from './doctor';
import { Inspector } from './inspector';
import { LessonRunner } from './lesson';
import { Palette } from './palette';
import { Scope } from './scope';
import { ProgressStore } from '../progress/store';
import { ProgressWatcher } from '../progress/watcher';
import { badgePopup, showAchievements } from './achievements';
import { ChallengeRunner } from './challenge';
import { Sound } from './sound';
import { startTour, tourDone } from './tour';
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
  readonly sound: Sound;
  readonly progress = new ProgressStore();
  private watcher: ProgressWatcher;
  private challenge: ChallengeRunner;
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
      openAchievements: () => showAchievements(this.progress),
      openChallenges: () => this.challenge.chooser(),
      exampleOpened: (id) => this.watcher.exampleOpened(id),
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
    this.sound = new Sound(app);
    this.watcher = new ProgressWatcher(app, this.progress);
    this.progress.onUnlock((id) => {
      this.sound.chime();
      badgePopup(id);
    });
    this.challenge = new ChallengeRunner(app, board, this.scope, {
      stars: (id) => this.progress.challengeStars(id),
      solved: (id, stars) => {
        this.watcher.challengeFinished(id, stars);
        this.sound.chime();
      },
      wrong: () => this.sound.pop(),
      started: () => {
        this.lesson.close();
        this.watcher.loadedReadyMade();
      },
    });
    this.lesson.onStart = () => {
      this.challenge.close();
      this.watcher.lessonStarted();
    };
    this.lesson.onFinish = (id) => this.watcher.lessonFinished(id);
    app.on('frame', () => {
      this.frame();
      this.sound.update();
      this.watcher.frame(performance.now());
    });
    app.onDamage = () => {
      this.sound.pop();
      this.watcher.partBurned();
    };
    app.onSwitch = () => this.sound.click();
    window.addEventListener('keydown', (e) => this.keys(e));
  }

  welcome(): void {
    showWelcome({
      newCircuit: () => void this.toolbar.act('new', document.body),
      resume: this.restored ? () => this.board.fit() : undefined,
      examples: () => this.toolbar.examples(),
      lessons: () => this.lesson.chooser(),
      tour: () => startTour(),
    });
    if (!tourDone()) this.tourAfterDialogs();
  }

  /** The very first time, start the tour once the welcome (and whatever it opened) has closed. */
  private tourAfterDialogs(): void {
    const wrap = document.getElementById('modal');
    if (!wrap) return;
    const obs = new MutationObserver(() => {
      if (!wrap.hidden) return;
      obs.disconnect();
      setTimeout(() => {
        if (wrap.hidden && !tourDone()) startTour();
      }, 400);
    });
    obs.observe(wrap, { attributes: true, attributeFilter: ['hidden'] });
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
    // Space and Enter on a focused button press that button; they must not also run the shortcut.
    if ((tag === 'BUTTON' || (e.target as HTMLElement).getAttribute('role') === 'radio') && (k === ' ' || k === 'enter')) return;
    if (ctrl && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    } else if (ctrl && k === 'y') {
      e.preventDefault();
      app.redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      void app.exportFile();
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
