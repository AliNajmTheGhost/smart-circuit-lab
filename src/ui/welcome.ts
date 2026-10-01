import { EXAMPLES } from '../examples';
import { t } from '../i18n';
import { LESSONS } from '../lessons/lessons';
import { PARTS } from '../model/library';
import { icon, modal } from './dom';

const SKIP_KEY = 'nabd.skipWelcome';

export interface WelcomeActions {
  newCircuit(): void;
  /** Present only when a circuit from last time was restored. */
  resume?: () => void;
  examples(): void;
  lessons(): void;
  tour(): void;
}

export function welcomeSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

/** The start screen: what to do first, in three big choices. */
export function showWelcome(actions: WelcomeActions): void {
  const cards: [string, string, string, string, keyof WelcomeActions][] = [];
  if (actions.resume) cards.push(['resume', 'restart', 'wResume', 'wResumeSub', 'resume']);
  cards.push(
    ['lessons', 'book', 'wLessons', 'wLessonsSub', 'lessons'],
    ['examples', 'bulb', 'wExamples', 'wExamplesSub', 'examples'],
    ['new', 'new', 'wNew', 'wNewSub', 'newCircuit'],
  );
  let skip = welcomeSkipped();
  modal(
    `<div class="welcome">
      <header class="w-hero">
        <svg class="w-mark" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14"/><path d="M6 26h9l4-12 7 22 5-14 3 4h8"/></svg>
        <div>
          <h1>${t('wTitle')}</h1>
          <p>${t('wSub')}</p>
        </div>
      </header>
      <div class="w-cards">
        ${cards
          .map(
            ([id, ic, title, sub], i) => `<button class="w-card${i === 0 ? ' primary' : ''}" data-w="${id}">
              <span class="w-ico">${icon(ic)}</span>
              <strong>${t(title)}</strong>
              <span>${t(sub)}</span>
            </button>`,
          )
          .join('')}
      </div>
      <div class="w-stats">
        <span><b>${PARTS.length}</b>${t('statParts')}</span>
        <span><b>${EXAMPLES.length}</b>${t('statExamples')}</span>
        <span><b>${LESSONS.length}</b>${t('statLessons')}</span>
        <span><b>3</b>${t('statGrades')}</span>
      </div>
      <button class="link w-tour" data-w="tour">${icon('eye')}${t('tourStart')}</button>
      <label class="w-skip"><input type="checkbox" data-skip${skip ? ' checked' : ''}><span>${t('wSkip')}</span></label>
    </div>`,
    (el, close) => {
      el.querySelector<HTMLInputElement>('[data-skip]')!.addEventListener('change', (e) => {
        skip = (e.target as HTMLInputElement).checked;
        try {
          localStorage.setItem(SKIP_KEY, skip ? '1' : '0');
        } catch {
          /* ignore */
        }
      });
      el.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-w]');
        if (!b) return;
        close();
        const id = b.dataset.w;
        if (id === 'resume') actions.resume?.();
        if (id === 'lessons') actions.lessons();
        if (id === 'examples') actions.examples();
        if (id === 'new') actions.newCircuit();
        if (id === 'tour') actions.tour();
      });
    },
    'welcome-card',
  );
}
