/** «إنجازاتي»: the badge popup when one is earned, and the window listing all badges. */
import { getLang, nameOf, t } from '../i18n';
import { LESSONS } from '../lessons/lessons';
import { BADGES, badgeById } from '../progress/badges';
import type { ProgressStore } from '../progress/store';
import { esc, icon, modal } from './dom';

/** A card that slides in at the top of the screen for a newly earned badge. */
export function badgePopup(id: string): void {
  const b = badgeById(id);
  if (!b) return;
  const el = document.createElement('div');
  el.className = 'badge-pop';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="badge-emoji">${b.icon}</span><div><small>${t('newBadge')}</small><strong>${esc(nameOf(b))}</strong><p>${esc(nameOf(b.desc))}</p></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, 4200);
}

function date(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(getLang() === 'ar' ? 'ar-IQ' : 'en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function showAchievements(store: ProgressStore): void {
  const earned = BADGES.filter((b) => store.has(b.id)).length;
  const lessons = LESSONS.filter((l) => store.lessonsDone().includes(l.id)).length;
  const cards = BADGES.map((b) => {
    const at = store.earnedAt(b.id);
    return `<div class="badge-card${at ? ' on' : ''}">
      <span class="badge-emoji">${at ? b.icon : '🔒'}</span>
      <strong>${esc(nameOf(b))}</strong>
      <p>${esc(nameOf(b.desc))}</p>
      ${at ? `<small>${date(at)}</small>` : ''}
    </div>`;
  }).join('');
  modal(
    `<header class="modal-head">${icon('trophy', 'ico big')}<div><h2>${t('achievements')}</h2><p class="muted">${t('achievementsIntro')}</p></div></header>
    <div class="ach-stats">
      <div><b>${earned}</b><span>/ ${BADGES.length} ${t('badgesWord')}</span></div>
      <div><b>${lessons}</b><span>/ ${LESSONS.length} ${t('lessonsWord')}</span></div>
      <div><b>${store.examplesOpened()}</b><span>${t('examplesWord')}</span></div>
    </div>
    <div class="ach-meter" aria-hidden="true"><i style="width:${Math.round((100 * earned) / BADGES.length)}%"></i></div>
    <div class="badge-grid">${cards}</div>`,
    () => {},
    'wide',
  );
}
