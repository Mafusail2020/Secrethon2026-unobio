import type { GraphSpec } from "../../../../api/types";
import { containerIds } from "../../graphUtils";
import { PHASE_DEFS, phaseOf, type PhaseId } from "../../phases";

export const GROUP_PREFIX = "group:";
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);

/** The steps of one pipeline phase, which the graph can fold into a single box. */
export interface PhaseGroup {
  id: string;
  phase: PhaseId;
  label: string;
  description: string;
  /** executing steps in this phase, in spec order */
  members: string[];
  /** boxes (bull and bear case) that sit inside the phase */
  containers: string[];
}

/** Every phase with two or more executing steps; a lone step has nothing to fold. */
export function phaseGroups(spec: GraphSpec): PhaseGroup[] {
  const containers = containerIds(spec);
  const runnable = spec.nodes.filter((n) => !containers.has(n.id));
  return PHASE_DEFS.flatMap((def) => {
    const members = runnable.filter((n) => phaseOf(n) === def.id);
    if (members.length < 2) return [];
    const parents = new Set(members.flatMap((m) => (m.parent ? [m.parent] : [])));
    return [
      {
        id: GROUP_PREFIX + def.id,
        phase: def.id,
        label: def.label,
        description: def.description,
        members: members.map((m) => m.id),
        containers: [...parents],
      },
    ];
  });
}

/** The groups folded before and open after: what a click or a button just unfolded. */
export function unfoldedGroups(groups: PhaseGroup[], before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return groups.filter((g) => before.has(g.id) && !after.has(g.id)).map((g) => g.id);
}

export interface VisibleGraph {
  /** what is drawn as a node: a step, or a folded group standing in for its steps */
  nodes: { id: string; group?: PhaseGroup }[];
  /** the edges between drawn nodes: no self-links, no duplicates */
  edges: { source: string; target: string }[];
  /** the drawn node that stands for a step */
  repOf: (nodeId: string) => string;
}

export function visibleGraph(spec: GraphSpec, groups: PhaseGroup[], collapsed: ReadonlySet<string>): VisibleGraph {
  const rep = new Map<string, string>();
  for (const g of groups) if (collapsed.has(g.id)) for (const m of g.members) rep.set(m, g.id);
  const repOf = (id: string) => rep.get(id) ?? id;

  const containers = containerIds(spec);
  const seen = new Set<string>();
  const nodes: VisibleGraph["nodes"] = [];
  for (const n of spec.nodes) {
    if (containers.has(n.id)) continue;
    const id = repOf(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, group: isGroupId(id) ? groups.find((g) => g.id === id) : undefined });
  }

  const edgeKeys = new Set<string>();
  const edges: VisibleGraph["edges"] = [];
  for (const e of spec.edges) {
    const source = repOf(e.source);
    const target = repOf(e.target);
    const key = `${source}->${target}`;
    if (source === target || edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source, target });
  }
  return { nodes, edges, repOf };
}
