import { defOf, pinWorld } from '../model/library';
import { keyOf, type CircuitDoc } from '../model/types';

/**
 * Turns the drawing into electrical nodes.
 * Node index -1 is the 0 V reference (ground); others are 0..nodeCount-1.
 */
export interface Netlist {
  nodeCount: number;
  /** Node of every pin, per part id. */
  pinNodes: Map<string, number[]>;
  /** Node of every point that has a pin or a wire end. */
  pointNode: Map<string, number>;
  /** Pins attached to each node (index node + 1, so ground is at 0). */
  nodePins: { part: string; pin: number }[][];
  /** Number of wire ends at each node (same indexing). */
  nodeWireEnds: number[];
  /** True when a ground symbol is on the board. */
  hasGround: boolean;
  /** When there is no ground symbol, the part whose negative pin was used as 0 V. */
  autoGroundPart: string | null;
  /** Precomputed tree walk for finding the current in each wire. */
  flow: WireFlowPlan;
}

interface WireFlowPlan {
  /** Points in BFS order. */
  order: string[];
  /** For each non-root point: the wire to its parent and whether the point is that wire's `a` end. */
  up: Map<string, { wire: string; isA: boolean; parent: string }>;
}

class UnionFind {
  parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) {
      this.parent.set(k, k);
      return k;
    }
    let r = k;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = k;
    while (c !== r) {
      const next = this.parent.get(c)!;
      this.parent.set(c, r);
      c = next;
    }
    return r;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const NEGATIVE_PIN: Record<string, number> = { battery: 1, psu: 1, ac: 1, funcgen: 1 };

export function buildNetlist(doc: CircuitDoc): Netlist {
  const uf = new UnionFind();
  for (const w of doc.wires) uf.union(keyOf(w.a), keyOf(w.b));
  const pinKeys = new Map<string, string[]>();
  for (const p of doc.parts) {
    const n = defOf(p.type).pins.length;
    const keys: string[] = [];
    for (let i = 0; i < n; i++) {
      const k = keyOf(pinWorld(p, i));
      uf.find(k);
      keys.push(k);
    }
    pinKeys.set(p.id, keys);
  }

  // Which root is 0 V?
  let groundRoots = new Set<string>();
  for (const p of doc.parts) if (p.type === 'ground') groundRoots.add(uf.find(pinKeys.get(p.id)![0]));
  const hasGround = groundRoots.size > 0;
  let autoGroundPart: string | null = null;
  if (!hasGround) {
    const src = doc.parts.find((p) => p.type in NEGATIVE_PIN);
    if (src) {
      autoGroundPart = src.id;
      groundRoots = new Set([uf.find(pinKeys.get(src.id)![NEGATIVE_PIN[src.type]])]);
    }
  }
  // All ground symbols are the same node even if not wired together.
  const rootIndex = new Map<string, number>();
  for (const r of groundRoots) rootIndex.set(r, -1);
  let nodeCount = 0;
  const indexOf = (root: string): number => {
    let i = rootIndex.get(root);
    if (i === undefined) {
      i = nodeCount++;
      rootIndex.set(root, i);
    }
    return i;
  };

  const pointNode = new Map<string, number>();
  for (const k of uf.parent.keys()) pointNode.set(k, indexOf(uf.find(k)));

  const pinNodes = new Map<string, number[]>();
  const nodePins: { part: string; pin: number }[][] = Array.from({ length: nodeCount + 1 }, () => []);
  for (const p of doc.parts) {
    const nodes = pinKeys.get(p.id)!.map((k) => pointNode.get(k)!);
    pinNodes.set(p.id, nodes);
    nodes.forEach((n, i) => nodePins[n + 1].push({ part: p.id, pin: i }));
  }
  const nodeWireEnds = new Array(nodeCount + 1).fill(0);
  for (const w of doc.wires) {
    nodeWireEnds[pointNode.get(keyOf(w.a))! + 1]++;
    nodeWireEnds[pointNode.get(keyOf(w.b))! + 1]++;
  }

  return { nodeCount, pinNodes, pointNode, nodePins, nodeWireEnds, hasGround, autoGroundPart, flow: planWireFlow(doc) };
}

function planWireFlow(doc: CircuitDoc): WireFlowPlan {
  const adj = new Map<string, { wire: string; other: string; isA: boolean }[]>();
  const push = (k: string, v: { wire: string; other: string; isA: boolean }) => {
    const l = adj.get(k);
    if (l) l.push(v);
    else adj.set(k, [v]);
  };
  for (const w of doc.wires) {
    const a = keyOf(w.a);
    const b = keyOf(w.b);
    push(a, { wire: w.id, other: b, isA: false });
    push(b, { wire: w.id, other: a, isA: true });
  }
  const order: string[] = [];
  const up = new Map<string, { wire: string; isA: boolean; parent: string }>();
  const seen = new Set<string>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    while (queue.length) {
      const k = queue.shift()!;
      order.push(k);
      for (const e of adj.get(k) ?? []) {
        if (seen.has(e.other)) continue;
        seen.add(e.other);
        // e.other is the child; it is wire end `a` when k is end `b`.
        up.set(e.other, { wire: e.wire, isA: e.isA, parent: k });
        queue.push(e.other);
      }
    }
  }
  return { order, up };
}

/**
 * Current in every wire, from the currents entering each pin.
 * Positive means flowing from the wire's `a` end to its `b` end.
 * Wires that close a loop inside one node carry no current here, which is fine for drawing.
 */
export function wireCurrents(doc: CircuitDoc, net: Netlist, pinCurrents: Map<string, number[]>): Map<string, number> {
  const sub = new Map<string, number>();
  for (const p of doc.parts) {
    const cur = pinCurrents.get(p.id);
    if (!cur) continue;
    const n = defOf(p.type).pins.length;
    for (let i = 0; i < n; i++) {
      const k = keyOf(pinWorld(p, i));
      // Current flowing into a device pin leaves the wire network there.
      sub.set(k, (sub.get(k) ?? 0) - (cur[i] ?? 0));
    }
  }
  const out = new Map<string, number>();
  const { order, up } = net.flow;
  for (let i = order.length - 1; i >= 0; i--) {
    const k = order[i];
    const e = up.get(k);
    if (!e) continue;
    const s = sub.get(k) ?? 0;
    // s flows from this point toward its parent.
    out.set(e.wire, e.isA ? s : -s);
    sub.set(e.parent, (sub.get(e.parent) ?? 0) + s);
  }
  return out;
}
