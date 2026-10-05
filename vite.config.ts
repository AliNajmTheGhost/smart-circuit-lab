import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { defineConfig } from 'vitest/config';

/**
 * `import data from './x.wasm?base64'` gives the file as base64 text, so the simulation core
 * travels inside the JavaScript and works from file:// and in the single offline file.
 */
function wasmBase64(): Plugin {
  return {
    name: 'nabd-wasm-base64',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.wasm?base64')) return null;
      const file = id.slice(0, -'?base64'.length);
      this.addWatchFile(file);
      return `export default ${JSON.stringify(readFileSync(file).toString('base64'))};`;
    },
  };
}

/**
 * The web app has no server of its own to send security headers, so its policy is written into
 * the page. `'wasm-unsafe-eval'` is needed because the simulation core is compiled from bytes
 * embedded in the bundle (see src/sim/wasm/load.ts), `data:` because the smaller font files are
 * inlined into the stylesheet, and `'unsafe-inline'` covers the splash screen's styles only —
 * no inline script is ever allowed. `frame-ancestors` is left out because a page cannot set it.
 *
 * The installed apps get their policy from `src-tauri/tauri.conf.json` instead: Tauri serves it
 * as a header and adds what its own bridge needs, so the tag is left out of those builds.
 * The single-file build inlines its scripts by design, so it is left out too.
 */
const WEB_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; media-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

function webCsp(enabled: boolean): Plugin {
  return {
    name: 'nabd-web-csp',
    transformIndexHtml(html) {
      if (!enabled) return html;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`);
    },
  };
}

// `npm run build:single` makes one self-contained nabd.html that opens offline by double-click,
// for school labs without internet. The normal build is the installable web app (PWA).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
process.env.VITE_APP_VERSION = pkg.version;

export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  // Tauri sets TAURI_ENV_* for the build it runs, which is how the web build is told apart.
  plugins: [wasmBase64(), webCsp(mode !== 'single' && !process.env.TAURI_ENV_PLATFORM), ...(mode === 'single' ? [viteSingleFile()] : [])],
  test: { setupFiles: ['tests/setup.ts'], include: [process.env.NABD_BENCH ? 'bench/**/*.test.ts' : 'tests/**/*.test.ts'] },
  build: mode === 'single' ? { target: 'es2022', outDir: 'dist-single', emptyOutDir: true } : { target: 'es2022' },
}));
