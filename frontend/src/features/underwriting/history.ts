import type { RunSummary } from "../../api/types";

export interface RunGroup {
  rootId: string;
  /** original run first, then each correction version */
  runs: RunSummary[];
  latest: RunSummary;
}

/** Runs that descend from the same original run form one group; newest group first. */
export function groupRuns(runs: RunSummary[]): RunGroup[] {
  const byId = new Map(runs.map((r) => [r.id, r]));
  const rootOf = (run: RunSummary): string => {
    let current = run;
    const seen = new Set<string>();
    while (current.parent_run_id && byId.has(current.parent_run_id) && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parent_run_id)!;
    }
    return current.id;
  };
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const root = rootOf(run);
    groups.set(root, [...(groups.get(root) ?? []), run]);
  }
  return [...groups.entries()]
    .map(([rootId, members]) => {
      const sorted = [...members].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { rootId, runs: sorted, latest: sorted[sorted.length - 1]! };
    })
    .sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
}
