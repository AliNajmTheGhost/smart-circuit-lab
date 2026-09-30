import { getLang, nameOf, t } from '../i18n';
import { CATEGORIES, PARTS, type Category } from '../model/library';
import type { App } from './app';
import { $, esc, icon } from './dom';
import { symbolSvg } from './symbols';

/** The component shelf: category tabs, search, and a grid of parts to place. */
export class Palette {
  private el = $('#palette');
  private cat: Category | 'all' = 'all';
  private query = '';

  constructor(private app: App) {
    app.on('mode', () => this.markActive());
    app.on('settings', () => this.refreshSymbols());
    this.build();
  }

  build(): void {
    const chips = [{ id: 'all', ar: 'الكل', en: 'All' }, ...CATEGORIES]
      .map((c) => `<button class="chip${this.cat === c.id ? ' on' : ''}" data-cat="${c.id}">${esc(nameOf(c))}</button>`)
      .join('');
    this.el.innerHTML = `
      <header class="shelf-head">
        <h2>${t('components')}</h2>
        <label class="search">${icon('search')}<input id="psearch" type="search" placeholder="${t('search')}" autocomplete="off" value="${esc(this.query)}"></label>
        <div class="chips" role="tablist">${chips}</div>
      </header>
      <div class="plist"></div>`;
    this.el.querySelector('.chips')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-cat]');
      if (!b) return;
      this.cat = b.dataset.cat as Category | 'all';
      this.el.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
      this.renderList();
    });
    $<HTMLInputElement>('#psearch', this.el).addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderList();
    });
    this.el.querySelector('.plist')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.pitem');
      if (!b) return;
      const type = b.dataset.type!;
      this.app.startPlacing(this.app.placing === type ? null : type);
      document.body.classList.remove('show-palette');
    });
    this.renderList();
  }

  private renderList(): void {
    const q = this.query;
    const groups = CATEGORIES.filter((c) => this.cat === 'all' || this.cat === c.id)
      .map((c) => {
        const items = PARTS.filter((p) => p.cat === c.id && (!q || `${p.ar} ${p.en}`.toLowerCase().includes(q)))
          .map((p) => {
            const b = p.box;
            const pad = 6;
            const params = Object.fromEntries(p.params.map((x) => [x.key, x.def]));
            return `<button class="pitem" data-type="${p.type}" title="${esc(nameOf(p.desc))}">
              <span class="pthumb"><svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}"><g class="sym">${symbolSvg(p.type, params, this.app.std)}</g></svg></span>
              <span class="pname">${esc(nameOf(p))}</span>
              <span class="psub">${esc(getLang() === 'ar' ? p.en : p.ar)}</span>
            </button>`;
          })
          .join('');
        return items ? `<section class="pgroup">${this.cat === 'all' ? `<h3>${esc(nameOf(c))}</h3>` : ''}<div class="pgrid">${items}</div></section>` : '';
      })
      .join('');
    this.el.querySelector('.plist')!.innerHTML = groups || `<p class="muted empty">${t('noMatch')}</p>`;
    this.markActive();
  }

  private markActive(): void {
    for (const b of this.el.querySelectorAll<HTMLElement>('.pitem')) b.classList.toggle('active', b.dataset.type === this.app.placing);
  }

  private refreshSymbols(): void {
    for (const b of this.el.querySelectorAll<HTMLElement>('.pitem')) {
      const p = PARTS.find((x) => x.type === b.dataset.type)!;
      const params = Object.fromEntries(p.params.map((x) => [x.key, x.def]));
      b.querySelector('.sym')!.innerHTML = symbolSvg(p.type, params, this.app.std);
    }
  }
}
