// Builds the Windows installer (NSIS) into target/release/bundle/nsis/:
//   npm run build:desktop
import { join } from 'node:path';
import { root, run } from './cargo.mjs';

run(process.execPath, [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'build']);
