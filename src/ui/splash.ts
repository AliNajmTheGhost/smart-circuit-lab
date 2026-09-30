import { t } from '../i18n';

export type SplashTask = [labelKey: string, run: () => unknown];

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Let the browser paint the progress bar, without depending on frames arriving (hidden tabs pause them). */
const nextFrame = () => new Promise<void>((r) => {
  requestAnimationFrame(() => r());
  setTimeout(r, 60);
});

/**
 * The opening screen: runs the start-up tasks one by one while the bar fills,
 * stays up long enough to be seen, then fades away. A tap skips the wait.
 */
export async function runSplash(tasks: SplashTask[]): Promise<void> {
  const el = document.getElementById('splash');
  if (!el) {
    for (const [, run] of tasks) await run();
    return;
  }
  const bar = el.querySelector<HTMLElement>('.sp-bar i');
  const status = el.querySelector<HTMLElement>('.sp-status');
  const pct = el.querySelector<HTMLElement>('.sp-pct');
  const minTime = reduced() ? 300 : 1900;
  const start = performance.now();
  let skip = false;
  el.addEventListener('click', () => (skip = true), { once: true });

  const show = (k: number, label: string) => {
    const p = Math.round((k / tasks.length) * 100);
    if (bar) bar.style.width = `${p}%`;
    if (pct) pct.textContent = `${p}%`;
    if (status) status.textContent = label;
  };

  try {
    for (let k = 0; k < tasks.length; k++) {
      const [key, run] = tasks[k];
      show(k, t(key));
      await nextFrame();
      await run();
    }
    show(tasks.length, t('splashReady'));
    // Let the bar reach the end and the pulse finish a sweep, unless the student tapped.
    while (!skip && performance.now() - start < minTime) await new Promise((r) => setTimeout(r, 50));
  } finally {
    // Whatever happened, never leave the student stuck behind the opening screen.
    el.classList.add('done');
    await new Promise((r) => setTimeout(r, reduced() ? 0 : 520));
    el.remove();
  }
}
