// Builds the signed Android app (APK) for phones with ARM processors (nearly all phones):
//   npm run build:android
//
// Needs JAVA_HOME (JDK 17), ANDROID_HOME and NDK_HOME; this script finds the usual Windows
// locations if they are not set. The signing key is read from ../nabd-signing/keystore.properties.
//
// Tauri links the compiled library into the Android project with a symbolic link, which Windows
// only allows in Developer Mode. Without it, Tauri stops after compiling; this script then copies
// the library itself and finishes the build with Gradle, so Developer Mode is not required.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env, root, run } from './cargo.mjs';

const TARGETS = [
  { tauri: 'aarch64', rust: 'aarch64-linux-android', abi: 'arm64-v8a', arch: 'arm64' },
  { tauri: 'armv7', rust: 'armv7-linux-androideabi', abi: 'armeabi-v7a', arch: 'arm' },
];

function firstDir(parent, prefix = '') {
  if (!existsSync(parent)) return null;
  const d = readdirSync(parent).filter((n) => n.startsWith(prefix)).sort().reverse()[0];
  return d ? join(parent, d) : null;
}

env.JAVA_HOME ??= firstDir('C:\\Program Files\\Microsoft', 'jdk-17');
env.ANDROID_HOME ??= join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk');
env.NDK_HOME ??= firstDir(join(env.ANDROID_HOME, 'ndk'));
for (const k of ['JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME']) {
  if (!env[k] || !existsSync(env[k])) throw new Error(`${k} not found; install it or set the variable`);
}

// Tauri and Gradle are called through node and java directly: Windows will not run .cmd/.bat files
// from a path with spaces.
const lib = (t) => join(root, 'target', t.rust, 'release', 'libnabd_app_lib.so');

for (const t of TARGETS) {
  // Tauri's own output is shown as it runs and kept, to tell the harmless symlink failure
  // (no Developer Mode) apart from a real build error.
  const r = spawnSync(process.execPath, [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'android', 'build', '--apk', '--target', t.tauri], {
    cwd: root,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  if (r.status === 0) continue;
  const symlinkOnly = /symbolic link/i.test(`${r.stdout}${r.stderr}`) && existsSync(lib(t));
  if (!symlinkOnly) throw new Error(`Rust build for ${t.tauri} failed`);
}

const android = join(root, 'src-tauri', 'gen', 'android');
for (const t of TARGETS) {
  const dir = join(android, 'app', 'src', 'main', 'jniLibs', t.abi);
  mkdirSync(dir, { recursive: true });
  copyFileSync(lib(t), join(dir, 'libnabd_app_lib.so'));
}

const skip = TARGETS.flatMap((t) => ['-x', `rustBuild${t.arch[0].toUpperCase()}${t.arch.slice(1)}Release`]);
run(join(env.JAVA_HOME, 'bin', 'java'), [
  '-classpath',
  join(android, 'gradle', 'wrapper', 'gradle-wrapper.jar'),
  'org.gradle.wrapper.GradleWrapperMain',
  '-p',
  android,
  'assembleUniversalRelease',
  `-PabiList=${TARGETS.map((t) => t.abi).join(',')}`,
  `-ParchList=${TARGETS.map((t) => t.arch).join(',')}`,
  `-PtargetList=${TARGETS.map((t) => t.tauri).join(',')}`,
  ...skip,
  '--console=plain',
]);
console.log(`APK: ${join(android, 'app', 'build', 'outputs', 'apk', 'universal', 'release', 'app-universal-release.apk')}`);
