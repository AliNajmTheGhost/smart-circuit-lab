import { t } from '../i18n';
import type { App } from './app';
import { $, esc, icon } from './dom';

const LEVEL_ICON: Record<string, string> = { burn: 'flame', error: 'stop', warn: 'warn', info: 'info' };

/** The circuit doctor card: problems found in the drawing and during the run. */
export class DoctorPanel {
  private el = $('#doctor');
  private last = 0;

  constructor(private app: App) {
    app.on('notes', () => this.render());
    this.render();
  }

  render(): void {
    const notes = this.app.notes;
    const body = notes.length
      ? `<ul class="notes">${notes
          .map(
            (n, i) =>
              `<li class="note ${n.level}" data-i="${i}" tabindex="0">${icon(LEVEL_ICON[n.level], 'ico nicon')}<span class="ntext">${esc(n.text)}</span></li>`,
          )
          .join('')}</ul>`
      : `<div class="all-good">${icon('check')}<span>${t('doctorOk')}</span></div>`;
    this.el.innerHTML = `
      <header class="card-head">
        <h2>${t('doctor')}</h2>
        ${notes.length ? `<span class="badge">${notes.length}</span>` : ''}
      </header>
      ${body}
      ${this.app.broken.size > 1 ? `<button class="btn small wide" data-do="repair-all">${icon('wrench')}<span>${t('repairAll')}</span></button>` : ''}`;
    this.el.querySelectorAll<HTMLElement>('.note').forEach((li) => {
      const go = () => {
        const n = this.app.notes[Number(li.dataset.i)];
        if (n?.parts[0] && this.app.part(n.parts[0])) this.app.select({ kind: 'part', id: n.parts[0] });
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    });
    this.el.querySelector('[data-do="repair-all"]')?.addEventListener('click', () => this.app.repair());
  }

  /** Numbers inside the messages (currents, powers) change while running; refresh them now and then. */
  tick(): void {
    const now = performance.now();
    if (now - this.last < 600) return;
    this.last = now;
    const texts = [...this.el.querySelectorAll<HTMLElement>('.ntext')];
    this.app.notes.forEach((n, i) => {
      if (texts[i] && texts[i].textContent !== n.text) texts[i].textContent = n.text;
    });
  }
}
