// Builds the Rust simulation core for the browser:
//   npm run build:wasm
// Output: src/sim/wasm/pkg/ (JavaScript glue + .wasm), loaded by src/sim/wasm/load.ts.
import { run } from './cargo.mjs';

run('cargo', ['build', '-p', 'nabd-wasm', '--target', 'wasm32-unknown-unknown', '--release']);
run('wasm-bindgen', ['target/wasm32-unknown-unknown/release/nabd_wasm.wasm', '--target', 'web', '--out-dir', 'src/sim/wasm/pkg']);
console.log('wasm built: src/sim/wasm/pkg');
