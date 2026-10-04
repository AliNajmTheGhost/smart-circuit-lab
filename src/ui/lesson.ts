import { nameOf, t } from '../i18n';
import { lessonCtx, LESSONS, type Lesson } from '../lessons/lessons';
import type { App } from './app';
import type { Board } from './board';
import { $, esc, icon, modal, toast } from './dom';
import type { Scope } from './scope';

/** "Exercise 8" for numbered exercises; unit names such as "الوحدة 5" stand alone. */
const refText = (ref: string): string => `${/^\d/.test(ref) ? `${t('exercise')} ` : ''}${esc(ref)}`;

/** Lesson chooser and the step card that checks the student's work as they go. */
export class LessonRunner {
  private el = $('#lesson');
  private lesson: Lesson | null = null;
  private step = 0;
  private passed = false;
  private hintShown = false;

  /** Told when a lesson starts and when the student finishes its last step. */
  onStart?: () => void;
  onFinish?: (id: string) => void;

  constructor(
    private app: App,
    private board: Board,
    private scope: Scope,
  ) {}

  chooser(): void {
    const grades = [1, 2, 3]
      .map((g) => {
        const list = LESSONS.filter((l) => l.grade === g);
        if (!list.length) return '';
        return `<section class="grade"><h3 class="grade-head"><span>${t(`grade${g}`)}</span><small>${list.length}</small></h3><div class="lesson-grid">${list
          .map(
            (l) => `<button class="lesson-item" data-l="${l.id}">
              <span class="lref">${refText(l.ref)}</span>
              <strong>${esc(nameOf(l))}</strong>
              <span class="lgoal">${esc(nameOf(l.goal))}</span>
              <span class="lsteps">${l.steps.length} ${t('stepsWord')} ${icon('chevron', 'ico go')}</span>
            </button>`,
          )
          .join('')}</div></section>`;
      })
      .join('');
    modal(
      `<header class="modal-head">${icon('book', 'ico big')}<div><h2>${t('lessons')}</h2><p class="muted">${t('lessonsIntro')}</p></div></header><div class="lesson-list">${grades}</div>`,
      (el, close) => {
        el.addEventListener('click', (e) => {
          const b = (e.target as Element).closest<HTMLElement>('[data-l]');
          if (!b) return;
          close();
          this.start(LESSONS.find((l) => l.id === b.dataset.l)!);
        });
      },
      'wide',
    );
  }

  start(l: Lesson): void {
    this.lesson = l;
    this.onStart?.();
    this.step = 0;
    this.passed = false;
    this.hintShown = false;
    this.app.load(l.build());
    this.app.restart();
    if (l.scopeWindow) this.scope.setWindow(l.scopeWindow);
    this.app.setRunning(true);
    this.board.fit();
    this.render();
  }

  render(): void {
    const l = this.lesson;
    if (!l) {
      this.el.hidden = true;
      return;
    }
    const s = l.steps[this.step];
    const last = this.step === l.steps.length - 1;
    const canNext = !s.check || this.passed;
    this.el.hidden = false;
    this.el.innerHTML = `
      <div class="lhead">
        <span class="lref">${refText(l.ref)}</span>
        <strong>${esc(nameOf(l))}</strong>
        <button class="icon-btn" data-ls="close" title="${t('close')}">${icon('close')}</button>
      </div>
      <div class="lprogress" aria-label="${t('step', { n: this.step + 1, total: l.steps.length })}">${l.steps
        .map((_, i) => `<span class="${i < this.step ? 'done' : i === this.step ? 'now' : ''}"></span>`)
        .join('')}</div>
      <div class="lstep">${t('step', { n: this.step + 1, total: l.steps.length })}</div>
      <p class="ltext">${esc(nameOf(s))}</p>
      ${s.hint ? (this.hintShown ? `<p class="lhint">${icon('bulb')}<span>${esc(nameOf(s.hint))}</span></p>` : `<button class="link" data-ls="hint">${icon('bulb')}${t('hint')}</button>`) : ''}
      ${s.check ? `<div class="lcheck ${this.passed ? 'ok' : ''}">${icon(this.passed ? 'check' : 'eye')}<span>${this.passed ? t('checkDone') : t('checkWaiting')}</span></div>` : ''}
      <div class="btn-row">
        <button class="btn" data-ls="back" ${this.step === 0 ? 'disabled' : ''}>${t('back')}</button>
        <button class="btn primary" data-ls="next" ${canNext ? '' : 'disabled'}>${last ? t('finish') : t('next')}</button>
      </div>`;
    this.el.onclick = (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-ls]');
      if (!b) return;
      const a = b.dataset.ls;
      if (a === 'close') this.close();
      if (a === 'hint') {
        this.hintShown = true;
        this.render();
      }
      if (a === 'back' && this.step > 0) this.go(this.step - 1);
      if (a === 'next') {
        if (last) {
          toast(t('lessonDone'));
          this.onFinish?.(l.id);
          this.close();
        } else this.go(this.step + 1);
      }
    };
  }

  private go(i: number): void {
    this.step = i;
    this.passed = false;
    this.hintShown = false;
    this.render();
  }

  get active(): boolean {
    return this.lesson !== null;
  }

  close(): void {
    this.lesson = null;
    this.render();
  }

  /** Called every frame while a lesson is open. */
  check(): void {
    const s = this.lesson?.steps[this.step];
    if (!s?.check || this.passed) return;
    try {
      if (s.check(lessonCtx(this.app))) {
        this.passed = true;
        this.render();
      }
    } catch {
      // A half-built circuit can make a check throw; it is simply tried again next frame.
    }
  }
}
