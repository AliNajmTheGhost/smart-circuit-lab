import { PARTS } from './library';

/** The part library without its display-only functions, as stable JSON for the Rust core. */
export function catalogJson(): string {
  const parts = PARTS.map((d) => ({
    type: d.type,
    pins: d.pins.map((p) => ({ x: p.x, y: p.y })),
    params: d.params.map((p) => ({ key: p.key, def: p.def })),
    optional: d.optional ?? [],
    internalNodes: d.internalNodes ?? 0,
  }));
  return JSON.stringify({ version: 1, parts }, null, 1) + '\n';
}
