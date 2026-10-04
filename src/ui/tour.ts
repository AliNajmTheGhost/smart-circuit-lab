/**
 * A first-time tour: a spotlight moves over each area of the screen with one sentence about it.
 * Steps whose target is hidden (e.g. side panels folded away on a phone) are skipped.
 */
import { t } from '../i18n';

const DONE_KEY = 'nabd.tourDone';

interface Step {
  /** CSS selector of the area to light up. */
  target: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { target: '#palette', title: 'tourPartsT', text: 'tourParts' },
  { target: '#stage', title: 'tourBoardT', text: 'tourBoard' },
  { target: '#inspector', title: 'tourInspectorT', text: 'tourInspector' },
  { target: '#doctor', title: 'tourDoctorT', text: 'tourDoctor' },
  { target: '.dock', title: 'tourDockT', text: 'tourDock' },
  { target: '[data-act="lessons"]', title: 'tourLessonsT', text: 'tourLessons' },
  { target: '[data-act="challenges"]', title: 'tourChallengesT', text: 'tourChallenges' },
  { target: '[data-act="achievements"]', title: 'tourBadgesT', text: 'tourBadges' },
];

export function tourDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* ignore */
  }
}

function visible(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

let running = false;

export function tourRunning(): boolean {
  return running;
}

export function startTour(): void {
  if (running) return;
  const steps = STEPS.filter((s) => visible(document.querySelector(s.target)));
  if (!steps.length) return;
  running = true;
  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const tip = document.createElement('div');
  tip.className = 'tour-tip';
  tip.setAttribute('role', 'dialog');
  document.body.append(spot, tip);
  let i = 0;

  const end = () => {
    running = false;
    markDone();
    spot.remove();
    tip.remove();
    removeEventListener('resize', place);
    removeEventListener('keydown', onKey, true);
  };

  function place(): void {
    const s = steps[i];
    const el = document.querySelector(s.target);
    if (!visible(el)) return end();
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const last = i === steps.length - 1;
    tip.innerHTML = `<small>${i + 1} / ${steps.length}</small><strong>${t(s.title)}</strong><p>${t(s.text)}</p>
      <div class="btn-row"><button class="btn" data-t="skip">${t('tourSkip')}</button><button class="btn primary" data-t="next">${last ? t('tourEnd') : t('next')}</button></div>`;
    // Beside the area when there is room, otherwise over its middle.
    const w = Math.min(320, innerWidth - 24);
    tip.style.width = `${w}px`;
    const th = tip.offsetHeight;
    let top = r.bottom + 12;
    if (top + th > innerHeight - 8) top = r.top - th - 12;
    if (top < 8) top = Math.max(8, r.top + r.height / 2 - th / 2);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    Object.assign(tip.style, { top: `${top}px`, left: `${left}px` });
    tip.querySelector<HTMLButtonElement>('[data-t="next"]')?.focus();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      end();
    }
  };

  tip.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-t]')?.dataset.t;
    if (a === 'skip') end();
    if (a === 'next') {
      if (++i >= steps.length) end();
      else place();
    }
  });
  addEventListener('resize', place);
  addEventListener('keydown', onKey, true);
  place();
}
