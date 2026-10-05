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

// `npm run build:single` makes one self-contained nabd.html that opens offline by double-click,
// for school labs without internet. The normal build is the installable web app (PWA).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
process.env.VITE_APP_VERSION = pkg.version;

export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  plugins: [wasmBase64(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  test: { setupFiles: ['tests/setup.ts'], include: [process.env.NABD_BENCH ? 'bench/**/*.test.ts' : 'tests/**/*.test.ts'] },
  build: mode === 'single' ? { target: 'es2022', outDir: 'dist-single', emptyOutDir: true } : { target: 'es2022' },
}));
