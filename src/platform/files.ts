/**
 * Opening and saving circuit files. In the app this uses the system's own dialogs;
 * in a browser it falls back to a download and a file picker.
 */
import { BRAND } from '../brand';
import { isApp } from './index';

export interface OpenedFile {
  name: string;
  text: string;
}

/** Save `text` as `<name>.nabd`. Resolves false if the student cancelled. */
export async function saveCircuitFile(name: string, text: string): Promise<boolean> {
  const fileName = `${safeName(name)}.${BRAND.ext}`;
  if (isApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('save_circuit', { name: fileName, text });
  }
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Ask for a circuit file. Resolves null if the student cancelled. */
export async function openCircuitFile(): Promise<OpenedFile | null> {
  if (isApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<OpenedFile | null>('open_circuit');
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${BRAND.ext},.nabd,.json`;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Files that arrive from outside: the file the app was started with (double-click on a .nabd),
 * and files double-clicked later while the app is already open.
 */
export async function onIncomingFile(handle: (f: OpenedFile) => void): Promise<void> {
  if (!isApp()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  await listen<OpenedFile>('open-file', (e) => handle(e.payload));
  const first = await invoke<OpenedFile | null>('launch_file');
  if (first) handle(first);
}

/** File names may not contain characters Windows forbids; Arabic letters are fine. */
function safeName(name: string): string {
  return (name.trim() || 'circuit').replace(/[\/:*?"<>|]+/g, '-').slice(0, 80);
}
