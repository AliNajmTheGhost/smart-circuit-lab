import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:single` makes one self-contained nabd.html that opens offline by double-click,
// for school labs without internet. The normal build is the installable web app (PWA).
export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173 },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: mode === 'single' ? { outDir: 'dist-single', emptyOutDir: true } : {},
}));
