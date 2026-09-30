import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/readex-pro/500.css';
import '@fontsource/readex-pro/600.css';
import '@fontsource/readex-pro/700.css';
import './styles.css';
import { EXAMPLES } from './examples';
import { App } from './ui/app';
import { Board } from './ui/board';
import { Panels } from './ui/panels';
import { runSplash } from './ui/splash';
import { welcomeSkipped } from './ui/welcome';

let app!: App;
let board!: Board;
let panels!: Panels;

/** Wait for the web fonts, but never hold the student up for more than a second and a half. */
const fontsReady = () => Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]);

await runSplash([
  ['splashFonts', fontsReady],
  [
    'splashEngine',
    () => {
      app = new App();
      board = new Board(app, document.getElementById('stage')!);
    },
  ],
  ['splashParts', () => (panels = new Panels(app, board))],
  [
    'splashCircuit',
    () => {
      // Open the last circuit, or a first example so the board never starts empty.
      panels.restored = app.restore();
      if (!panels.restored) app.load(EXAMPLES[0].build(), false);
      board.render();
      board.fit();
    },
  ],
]);

board.fit();
window.addEventListener('resize', () => board.render());

const loop = (now: number) => {
  app.tick(now);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

if (!welcomeSkipped()) panels.welcome();

// Installable, offline-capable app when served over http(s); the single-file build skips this.
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
