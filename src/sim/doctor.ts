import { defOf, isGate } from '../model/library';
import type { CircuitDoc } from '../model/types';
import type { Netlist } from './netlist';

export interface DoctorNote {
  level: 'burn' | 'error' | 'warn' | 'info';
  key: string;
  parts: string[];
  vars?: Record<string, string | number>;
}

const SOURCES = new Set(['battery', 'psu', 'ac', 'funcgen', 'logicin', 'multimeter']);

/** Checks that need only the drawing, not the simulation. */
export function staticChecks(doc: CircuitDoc, net: Netlist): DoctorNote[] {
  const notes: DoctorNote[] = [];
  if (doc.parts.length === 0) return notes;
  const byId = new Map(doc.parts.map((p) => [p.id, p]));

  if (!doc.parts.some((p) => SOURCES.has(p.type) || isGate(p.type))) notes.push({ level: 'info', key: 'doc.noSource', parts: [] });

  if (!net.hasGround && net.autoGroundPart) notes.push({ level: 'info', key: 'doc.noGround', parts: [net.autoGroundPart] });

  for (const p of doc.parts) {
    const def = defOf(p.type);
    const nodes = net.pinNodes.get(p.id)!;

    if (['battery', 'psu', 'ac', 'funcgen'].includes(p.type) && nodes[0] === nodes[1])
      notes.push({ level: 'error', key: 'doc.sourceShorted', parts: [p.id] });

    nodes.forEach((n, i) => {
      const alone = net.nodePins[n + 1].length === 1 && net.nodeWireEnds[n + 1] === 0;
      const onlyWires = net.nodePins[n + 1].length === 1 && net.nodeWireEnds[n + 1] > 0;
      if (!alone && !onlyWires) return;
      if (p.type === 'ground' || p.type === 'probe' || def.optional?.includes(i)) return;
      if (isGate(p.type) && i < def.pins.length - 1) notes.push({ level: 'warn', key: 'doc.gateInput', parts: [p.id] });
      else notes.push({ level: 'warn', key: 'doc.openPin', parts: [p.id], vars: { pin: `${i}` } });
    });

    if (p.type === 'voltmeter') {
      const others = nodes.map((n) => net.nodePins[n + 1].filter((q) => q.part !== p.id));
      if (others.every((o) => o.length === 1) && others[0][0].part !== others[1][0].part) {
        const types = others.map((o) => byId.get(o[0].part)?.type);
        if (!types.includes('ground')) notes.push({ level: 'warn', key: 'doc.voltmeterSeries', parts: [p.id] });
      }
    }
  }
  return notes;
}
