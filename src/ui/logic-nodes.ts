import { defOf, isGate } from '../model/library';
import type { CircuitDoc } from '../model/types';
import type { NetView } from '../sim/wasm/engine';

/** Parts whose pins speak logic levels. Inputs are on their left side, outputs on their right. */
const DIGITAL = new Set(['dff', 'jkff', 'counter', 'bcd7', 'logicin', 'logicout']);
/** Parts that only look at a node and never set its voltage. */
const PASSIVE_READERS = new Set(['probe', 'voltmeter', 'multimeter']);

export interface LogicNode {
  /** Digital outputs connected to this node. Two or more can fight each other. */
  outs: number;
  /** Something sets the voltage here: a digital output or any analog part. */
  driven: boolean;
}

export type LogicState = '1' | '0' | 'Z' | 'X';

export const isDigitalPart = (type: string): boolean => isGate(type) || DIGITAL.has(type);

/** The nodes that touch a digital pin, and what drives each of them. */
export function logicNodes(doc: CircuitDoc, net: NetView): Map<number, LogicNode> {
  const out = new Map<number, LogicNode>();
  for (const p of doc.parts) {
    if (!isDigitalPart(p.type)) continue;
    const nodes = net.pinNodes.get(p.id) ?? [];
    defOf(p.type).pins.forEach((pin, i) => {
      const n = nodes[i];
      if (n === undefined || n < 0) return;
      const e = out.get(n) ?? { outs: 0, driven: false };
      if (pin.x > 0) {
        e.outs++;
        e.driven = true;
      }
      out.set(n, e);
    });
  }
  for (const p of doc.parts) {
    if (isDigitalPart(p.type) || PASSIVE_READERS.has(p.type)) continue;
    for (const n of net.pinNodes.get(p.id) ?? []) {
      const e = out.get(n);
      if (e) e.driven = true;
    }
  }
  return out;
}

/** TTL reading of a digital node: thresholds 0.8 V and 2 V, like the simulated chips. */
export function logicState(info: LogicNode, v: number): LogicState {
  if (!info.driven) return 'Z';
  // Two outputs pulling against each other sit half-way: a short between a 1 and a 0.
  if (info.outs >= 2 && v > 0.8 && v < 4.2) return 'X';
  if (v >= 2) return '1';
  if (v <= 0.8) return '0';
  // Between the thresholds the chips cannot tell 0 from 1: shown like a floating input.
  return 'Z';
}
