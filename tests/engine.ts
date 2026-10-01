/**
 * The engine the tests run against. Default: the Rust core (WebAssembly).
 * `NABD_ENGINE=ts npx vitest run` runs the same tests on the original TypeScript engine,
 * so the two can be compared at any time.
 */
import type { CircuitDoc } from '../src/model/types';
import { staticChecks } from '../src/sim/doctor';
import { Engine as TsEngine } from '../src/sim/engine';
import { WasmEngine } from '../src/sim/wasm/engine';

export const ENGINE_KIND = process.env.NABD_ENGINE === 'ts' ? 'ts' : 'wasm';

/** Engine that notices parameters changed directly on the document, as the tests do. */
class TestEngine extends WasmEngine {
  constructor(doc: CircuitDoc, dt = 1e-5, broken: Set<string> = new Set()) {
    super(doc, dt, broken, { watchParams: true });
  }
}

export const Engine = (ENGINE_KIND === 'ts' ? TsEngine : TestEngine) as unknown as typeof TestEngine;
export type Engine = TestEngine;

/** The circuit doctor's drawing checks, from whichever engine is in use. */
export function checks(doc: CircuitDoc, e: Engine) {
  return ENGINE_KIND === 'ts' ? staticChecks(doc, (e as unknown as TsEngine).net) : e.staticChecks();
}
