import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { EXAMPLES } from './examples';
import { App } from './ui/app';
import { Board } from './ui/board';
import { Panels } from './ui/panels';

const app = new App();
const board = new Board(app, document.getElementById('stage')!);
new Panels(app, board);

// Open the last circuit, or a first example so the board never starts empty.
if (!app.restore()) app.load(EXAMPLES[0].build(), false);
board.render();
requestAnimationFrame(() => board.fit());
window.addEventListener('resize', () => board.render());

const loop = (now: number) => {
  app.tick(now);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

// Installable, offline-capable app when served over http(s); the single-file build skips this.
if (import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* offline support is optional */
  });
}
