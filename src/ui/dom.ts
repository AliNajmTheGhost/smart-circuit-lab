import { t } from '../i18n';

/** Small DOM helpers shared by every panel. */

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

/**
 * Text on its way into a panel, never markup. It takes any value, because a circuit file may
 * hold something that is not a string, and escapes single quotes too so the result is safe
 * inside an attribute however it is quoted.
 */
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Stroke icons on a 24×24 grid, drawn in the current text colour. */
const ICON: Record<string, string> = {
  new: 'M6 3h9l4 4v14H6z M14 3v5h5 M12 11v6 M9 14h6',
  open: 'M3 7h6l2 2h10v10H3z',
  save: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  undo: 'M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 7l5 5-5 5 M20 12H9a5 5 0 0 0 0 10h3',
  run: 'M8 5.5v13l11-6.5z',
  pause: 'M8.5 5v14 M15.5 5v14',
  restart: 'M4 12a8 8 0 1 0 3-6.2 M4 4v5h5',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z M4 19V5 M9 8h6',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  scope: 'M3 5h18v14H3z M3 12h3l2-4 3 8 3-6 2 2h5',
  parts: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  props: 'M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M14 4v4 M10 10v4 M16 16v4',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v5h-5',
  flip: 'M3 12h18 M12 3l-4 5h8z M12 21l-4-5h8z',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  wrench: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 0-2-2z',
  close: 'M6 6l12 12 M18 6L6 18',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  auto: 'M12 3a9 9 0 1 0 0 18z M12 3a9 9 0 0 1 0 18',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  home: 'M4 11l8-7 8 7 M6 9.5V20h12V9.5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16 16l4.5 4.5',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3-.5-3 .5-6 1-8.5z',
  stop: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5.6 5.6l12.8 12.8',
  warn: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v6 M12 7.5h.01',
  check: 'M4 12.5l5 5L20 6.5',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0z M7 6H4v1a3 3 0 0 0 3 3 M17 6h3v1a3 3 0 0 1-3 3 M12 14v4 M8 20h8',
  chevron: 'M9 6l6 6-6 6',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  grid: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
  keyboard: 'M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10',
};

export const icon = (name: string, cls = 'ico'): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name] ?? ''}"/></svg>`;

/** A short message at the bottom of the screen. */
export function toast(msg: string, bad = false): void {
  const el = $('#toast');
  el.textContent = msg;
  el.className = bad ? 'show bad' : 'show';
  clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(window.setTimeout(() => (el.className = ''), 2600));
}

/** A centred dialog. `bind` wires its buttons; `close` removes it. */
export function modal(html: string, bind: (el: HTMLElement, close: () => void) => void, cls = ''): void {
  const wrap = $('#modal');
  wrap.innerHTML = `<div class="modal-card ${cls}" role="dialog" aria-modal="true"><button class="icon-btn modal-x" title="${t('close')}">${icon('close')}</button>${html}</div>`;
  wrap.hidden = false;
  const close = () => {
    wrap.hidden = true;
    wrap.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Escape closes the dialog only; it must not also clear the selection on the board.
    e.stopPropagation();
    close();
  };
  document.addEventListener('keydown', onKey);
  wrap.onclick = (e) => {
    if (e.target === wrap || (e.target as Element).closest('.modal-x')) close();
  };
  bind(wrap.querySelector('.modal-card')!, close);
}

export function confirmBox(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    modal(
      `<p class="confirm-text">${esc(text)}</p><div class="btn-row"><button class="btn" data-c="no">${t('no')}</button><button class="btn primary" data-c="yes">${t('yes')}</button></div>`,
      (el, close) => {
        el.addEventListener('click', (e) => {
          const b = (e.target as Element).closest<HTMLElement>('[data-c]');
          if (!b) return;
          close();
          resolve(b.dataset.c === 'yes');
        });
      },
      'narrow',
    );
  });
}

/** A menu that hangs under a button and closes when you click elsewhere. */
export function popover(anchor: HTMLElement, html: string, bind: (el: HTMLElement, close: () => void) => void): void {
  document.querySelector('.popover')?.remove();
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const below = r.bottom + 8 + h < window.innerHeight;
  el.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
  const left = rtl ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  bind(el, close);
}
