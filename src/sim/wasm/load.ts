/**
 * Loads the Rust simulation core. The .wasm file is embedded in the JavaScript bundle,
 * so the program still opens from a single offline file by double-click (no fetch from disk).
 * Call `loadCore()` once at start-up before creating engines.
 */
import init, { chooseDt, partTypes, Sim, traceCurves } from './pkg/nabd_wasm.js';
import wasmBase64 from './pkg/nabd_wasm_bg.wasm?base64';

let ready: Promise<void> | null = null;
let loaded = false;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function loadCore(): Promise<void> {
  ready ??= init({ module_or_path: decode(wasmBase64) }).then(() => {
    if (partTypes() < 1) throw new Error('simulation core has no parts');
    loaded = true;
  });
  return ready;
}

export function coreLoaded(): boolean {
  return loaded;
}

export { chooseDt, Sim, traceCurves };
