/** «حول البرنامج»: name, version, who made it and the licence. */
import { BRAND, logoSvg, VERSION } from '../brand';
import { getLang, t } from '../i18n';
import { isApp } from '../platform';
import { modal } from './dom';

export function showAbout(): void {
  const ar = getLang() === 'ar';
  modal(
    `<div class="about">
      ${logoSvg('about-logo')}
      <h2>${ar ? BRAND.ar : BRAND.en}</h2>
      <p class="about-en">${ar ? BRAND.en : BRAND.ar} · ${BRAND.short}</p>
      <p class="muted">${t('version')} <span dir="ltr">${VERSION}</span></p>
      <p class="about-credit">${t('madeBy')}: <strong>${ar ? BRAND.author.ar : BRAND.author.en}</strong></p>
      <p class="muted" dir="ltr">© ${BRAND.year} ${BRAND.author.en}</p>
      <p class="about-license">${t('licenseText')}</p>
      <p class="about-license"><a href="${BRAND.repo}" target="_blank" rel="noopener">${t('sourceCode')}</a> <span dir="ltr">${BRAND.repo.replace('https://', '')}</span></p>
    </div>`,
    (el) => {
      // Inside the installed app the link goes to the system browser through a native command.
      el.querySelector('a')?.addEventListener('click', async (e) => {
        if (!isApp()) return;
        e.preventDefault();
        const { invoke } = await import('@tauri-apps/api/core');
        void invoke('open_project_page').catch(() => {});
      });
    },
  );
}
