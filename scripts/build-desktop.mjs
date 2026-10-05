// Builds the Windows installer (NSIS) into target/release/bundle/nsis/:
//   npm run build:desktop            small installer; downloads WebView2 if the PC lacks it
//   npm run build:desktop:offline    larger installer that carries WebView2, for PCs without internet
import { readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { root, run } from './cargo.mjs';

const offline = process.argv.includes('--offline');
const args = [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'build'];
if (offline) args.push('--config', join(root, 'src-tauri', 'tauri.offline.conf.json'));
run(process.execPath, args);

if (offline) {
  // Both builds write the same file name: move the offline one to its own name so the next
  // normal build does not get mistaken for it (and the reverse).
  const nsis = join(root, 'target', 'release', 'bundle', 'nsis');
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const base = `${conf.productName}_${conf.version}_x64`;
  renameSync(join(nsis, `${base}-setup.exe`), join(nsis, `${base}-offline-setup.exe`));
  console.log(`offline installer: ${join(nsis, `${base}-offline-setup.exe`)}`);
}
