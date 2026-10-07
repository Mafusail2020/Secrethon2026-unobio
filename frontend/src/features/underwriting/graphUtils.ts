import type { GraphSpec, NodeSpec, RunSummary } from "../../api/types";

export function containerIds(spec: GraphSpec): Set<string> {
  return new Set(spec.nodes.flatMap((n) => (n.parent ? [n.parent] : [])));
}

/** Nodes that actually execute; containers only group their inner nodes. */
export function runnableNodes(spec: GraphSpec): NodeSpec[] {
  const containers = containerIds(spec);
  return spec.nodes.filter((n) => !containers.has(n.id));
}

/** The corrected node (a container means all its inner nodes) plus everything downstream. */
export function affectedSet(spec: GraphSpec, nodeId: string): Set<string> {
  const inner = spec.nodes.filter((n) => n.parent === nodeId).map((n) => n.id);
  const base = inner.length ? inner : [nodeId];
  const found = new Set(base);
  const stack = [...base];
  while (stack.length) {
    const current = stack.pop()!;
    for (const edge of spec.edges) {
      if (edge.source === current && !found.has(edge.target)) {
        found.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return found;
}

export function rootOf(runs: RunSummary[], runId: string): string {
  const byId = new Map(runs.map((r) => [r.id, r]));
  let current = byId.get(runId);
  while (current?.parent_run_id && byId.has(current.parent_run_id)) {
    current = byId.get(current.parent_run_id);
  }
  return current?.id ?? runId;
}

/** Every run that descends from the same original run, oldest first. */
export function familyOf(runs: RunSummary[], runId: string): RunSummary[] {
  const root = rootOf(runs, runId);
  return runs
    .filter((r) => rootOf(runs, r.id) === root)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
