/**
 * The program's name, logo and credits in one place, so the splash, header, welcome screen,
 * About dialog and saved files always agree.
 */
export const BRAND = {
  ar: 'مختبر الدوائر الذكية',
  en: 'Smart Circuit Lab',
  short: 'SCL',
  /** Who made the program, shown in About and on the splash screen. */
  author: { ar: 'المهندس علي نجم', en: 'Eng. Ali Najm' },
  year: 2026,
  /** File extension for saved circuits; older .nabd files still open. */
  ext: 'sclab',
  repo: 'https://github.com/AliNajmTheGhost/smart-circuit-lab',
};

/** The program version, from package.json (set by Vite at build time). */
export const VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0';

/** The logo (an integrated circuit with a resistor inside) as inline SVG. */
export const logoSvg = (cls = ''): string =>
  `<svg class="${cls}" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="26" fill="#1f2937"/><g fill="#9ca3af"><rect x="20" y="44" width="12" height="5" rx="1.5"/><rect x="20" y="58" width="12" height="5" rx="1.5"/><rect x="20" y="72" width="12" height="5" rx="1.5"/><rect x="88" y="44" width="12" height="5" rx="1.5"/><rect x="88" y="58" width="12" height="5" rx="1.5"/><rect x="88" y="72" width="12" height="5" rx="1.5"/></g><rect x="32" y="32" width="56" height="56" rx="10" fill="none" stroke="#e8eef2" stroke-width="5"/><path d="M40 60 L46 50 L52 70 L58 50 L64 70 L70 50 L76 70 L80 60" fill="none" stroke="#f5b400" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="40" cy="40" r="2.5" fill="#e8eef2"/></svg>`;
