/**
 * Repair challenges on screen: the chooser, and the card that follows the student while they
 * measure and pick the faulty part. Voltage colours and current dots are hidden during a
 * challenge so the student has to use the instruments, as in the workshop.
 */
import { buildChallenge, CHALLENGES, faultyPart, type Challenge } from '../challenges/challenges';
import { nameOf, t } from '../i18n';
import type { App } from './app';
import type { Board } from './board';
import { $, esc, icon, modal, toast } from './dom';
import type { Scope } from './scope';

export interface ChallengeHooks {
  /** Stars (1–3) already earned for a challenge, 0 if not solved yet. */
  stars(id: string): number;
  /** The student found the fault; `stars` depends on the number of wrong guesses. */
  solved(id: string, stars: number): void;
  /** A wrong part was replaced. */
  wrong(): void;
  /** A challenge was opened (so a running lesson can close). */
  started(): void;
}

const starsText = (n: number): string => '★'.repeat(n) + '☆'.repeat(3 - n);

export class ChallengeRunner {
  private el = $('#challenge');
  private c: Challenge | null = null;
  private faulty: string | undefined;
  private wrongGuesses = 0;
  private hintShown = false;
  private solved = false;
  private feedback = '';
  /** The view settings in force before the challenge, restored afterwards. */
  private saved: { showVolt: boolean; showCurrent: boolean } | null = null;

  constructor(
    private app: App,
    private board: Board,
    private scope: Scope,
    private hooks: ChallengeHooks,
  ) {
    app.on('select', () => this.c && !this.solved && this.render());
    // Opening another circuit ends the challenge.
    app.on('doc', () => {
      if (this.c && this.faulty && !app.part(this.faulty)) this.close();
    });
  }

  get active(): boolean {
    return this.c !== null;
  }

  chooser(): void {
    const grades = [1, 2, 3]
      .map((g) => {
        const list = CHALLENGES.filter((c) => c.grade === g);
        if (!list.length) return '';
        return `<section class="grade"><h3 class="grade-head"><span>${t(`grade${g}`)}</span><small>${list.length}</small></h3><div class="lesson-grid">${list
          .map((c) => {
            const s = this.hooks.stars(c.id);
            return `<button class="lesson-item" data-c="${c.id}">
              <span class="lref">${s ? `<span class="stars">${starsText(s)}</span>` : t('challengeNew')}</span>
              <strong>${esc(nameOf(c))}</strong>
              <span class="lgoal">${esc(nameOf(c.symptom))}</span>
              <span class="lsteps">${t('challengeStart')} ${icon('chevron', 'ico go')}</span>
            </button>`;
          })
          .join('')}</div></section>`;
      })
      .join('');
    modal(
      `<header class="modal-head">${icon('wrench', 'ico big')}<div><h2>${t('challenges')}</h2><p class="muted">${t('challengesIntro')}</p></div></header><div class="lesson-list">${grades}</div>`,
      (el, close) => {
        el.addEventListener('click', (e) => {
          const b = (e.target as Element).closest<HTMLElement>('[data-c]');
          if (!b) return;
          close();
          this.start(CHALLENGES.find((c) => c.id === b.dataset.c)!);
        });
      },
      'wide',
    );
  }

  start(c: Challenge): void {
    this.restoreView();
    this.hooks.started();
    this.c = c;
    this.wrongGuesses = 0;
    this.hintShown = false;
    this.solved = false;
    this.feedback = '';
    const app = this.app;
    // Cleared first: loading the new circuit must not look like leaving the old challenge.
    this.faulty = undefined;
    app.load(buildChallenge(c));
    this.faulty = faultyPart(app.doc);
    this.saved = { showVolt: app.showVolt, showCurrent: app.showCurrent };
    app.showVolt = false;
    app.showCurrent = false;
    app.emit('settings');
    app.restart();
    // The scope takes half the screen; show it only when the circuit has probes to watch.
    app.setOption('scopeOpen', app.doc.parts.some((p) => p.type === 'probe' || p.type === 'bode'));
    if (c.scopeWindow) this.scope.setWindow(c.scopeWindow);
    app.setRunning(true);
    this.board.fit();
    this.render();
  }

  private restoreView(): void {
    if (!this.saved) return;
    this.app.showVolt = this.saved.showVolt;
    this.app.showCurrent = this.saved.showCurrent;
    this.saved = null;
    this.app.emit('settings');
  }

  close(): void {
    this.c = null;
    this.restoreView();
    this.render();
  }

  private selectedPart(): string | null {
    const sel = this.app.sel;
    return sel.parts.size === 1 && sel.wires.size === 0 ? [...sel.parts][0] : null;
  }

  private replace(): void {
    const c = this.c;
    const id = this.selectedPart();
    if (!c || !id) return;
    const part = this.app.part(id);
    if (id === this.faulty) {
      this.solved = true;
      const stars = this.wrongGuesses === 0 ? 3 : this.wrongGuesses === 1 ? 2 : 1;
      // A new part goes in: the hidden fault disappears and the circuit comes back to life.
      this.app.commit(
        (d) => {
          const p = d.parts.find((q) => q.id === id);
          if (p) delete p.params._fault;
        },
        { history: false },
      );
      this.restoreView();
      this.hooks.solved(c.id, stars);
      this.feedback = '';
      this.render(stars);
    } else {
      this.wrongGuesses++;
      this.feedback = t('challengeWrong', { label: part?.label ?? '' });
      this.hooks.wrong();
      toast(this.feedback, true);
      this.render();
    }
  }

  private render(stars = 0): void {
    const c = this.c;
    if (!c) {
      this.el.hidden = true;
      return;
    }
    const sel = this.selectedPart();
    const selLabel = sel ? (this.app.part(sel)?.label ?? '') : '';
    this.el.hidden = false;
    const body = this.solved
      ? `<div class="lcheck ok">${icon('check')}<span>${t('challengeSolved')} <span class="stars">${starsText(stars)}</span></span></div>
         <p class="ltext">${esc(nameOf(c.explain))}</p>
         <div class="btn-row"><button class="btn" data-ch="list">${t('challengeMore')}</button><button class="btn primary" data-ch="close">${t('finish')}</button></div>`
      : `<p class="ltext">${esc(nameOf(c.symptom))}</p>
         <p class="ctask">${icon('wrench')}<span>${t('challengeTask')}</span></p>
         ${this.hintShown ? `<p class="lhint">${icon('bulb')}<span>${esc(nameOf(c.hint))}</span></p>` : `<button class="link" data-ch="hint">${icon('bulb')}${t('hint')}</button>`}
         ${this.feedback ? `<p class="cwrong">${esc(this.feedback)}</p>` : ''}
         <div class="btn-row">
           <button class="btn primary" data-ch="replace" ${sel ? '' : 'disabled'}>${sel ? t('challengeReplace', { label: selLabel }) : t('challengePick')}</button>
         </div>`;
    this.el.innerHTML = `
      <div class="lhead">
        <span class="lref">${icon('wrench', 'ico tiny')} ${t('challengeTag')}</span>
        <strong>${esc(nameOf(c))}</strong>
        <button class="icon-btn" data-ch="close" title="${t('close')}">${icon('close')}</button>
      </div>
      ${body}`;
    this.el.onclick = (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-ch]')?.dataset.ch;
      if (a === 'close') this.close();
      if (a === 'list') {
        this.close();
        this.chooser();
      }
      if (a === 'hint') {
        this.hintShown = true;
        this.render();
      }
      if (a === 'replace') this.replace();
    };
  }
}
