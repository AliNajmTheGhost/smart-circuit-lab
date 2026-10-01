// Runs cargo even when ~/.cargo/bin is not on PATH yet (a terminal opened before Rust was installed):
//   node scripts/cargo.mjs test --workspace
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
export const env = { ...process.env, [pathKey]: `${join(homedir(), '.cargo', 'bin')}${delimiter}${process.env[pathKey]}` };
export const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, stdio: 'inherit' });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    run('cargo', process.argv.slice(2));
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}
