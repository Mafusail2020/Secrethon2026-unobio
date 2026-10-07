import type { RunEvent } from "../../../../api/types";

export type Level = "debug" | "info" | "warn" | "error";
export type MinLevel = "all" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function eventLevel(event: RunEvent): Level {
  if (event.type === "node.failed" || event.type === "run.failed") return "error";
  if (event.type === "node.skipped") return "warn";
  if (event.type === "node.log") {
    const level = String((event.data as Record<string, unknown>).level ?? "info");
    return level in RANK ? (level as Level) : "info";
  }
  return "info";
}

export function describeEvent(event: RunEvent): string {
  const d = event.data as Record<string, unknown>;
  switch (event.type) {
    case "node.log":
      return String(d.message ?? "");
    case "llm.call":
      return `${String(d.model)} · ${String(d.purpose)} · ${Number(d.tokens_in)}/${Number(d.tokens_out)} tokens${d.cached ? " · cached" : ""}`;
    case "node.completed":
      return `done in ${(Number(d.duration_ms ?? 0) / 1000).toFixed(1)}s`;
    case "node.reused":
      return `reused from ${String(d.from_run ?? "the previous run")}`;
    case "node.failed":
      return String(d.error ?? "failed");
    case "node.skipped":
      return String(d.message ?? d.reason ?? "skipped");
    case "run.started":
      return d.parent_run_id ? `re-run of ${String(d.parent_run_id)}` : "run started";
    case "run.completed":
      return `decision: ${String(d.decision ?? "")}`;
    case "run.failed":
      return String(d.error ?? "");
    default:
      return "";
  }
}

export interface LogFilters {
  node: string;
  minLevel: MinLevel;
  query: string;
}

export const noLogFilters: LogFilters = { node: "", minLevel: "all", query: "" };

export function filterEvents(events: RunEvent[], f: LogFilters): RunEvent[] {
  const needle = f.query.trim().toLowerCase();
  const min = f.minLevel === "all" ? 0 : RANK[f.minLevel];
  return events.filter((e) => {
    if (f.node && e.node_id !== f.node) return false;
    if (RANK[eventLevel(e)] < min) return false;
    if (!needle) return true;
    return `${e.node_id ?? ""} ${e.type} ${describeEvent(e)}`.toLowerCase().includes(needle);
  });
}

/** Events grouped by node in the order each node first appears; run-level events come first. */
export function groupByNode(events: RunEvent[]): { node: string | null; events: RunEvent[] }[] {
  const groups = new Map<string | null, RunEvent[]>();
  for (const e of events) groups.set(e.node_id, [...(groups.get(e.node_id) ?? []), e]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : 0))
    .map(([node, list]) => ({ node, events: list }));
}

export function offsetSeconds(from: string, to: string): string {
  return `+${((new Date(to).getTime() - new Date(from).getTime()) / 1000).toFixed(1)}s`;
}

export function toText(events: RunEvent[]): string {
  const first = events[0]?.ts;
  return events
    .map((e) => `${first ? offsetSeconds(first, e.ts) : ""}\t${e.node_id ?? "run"}\t${e.type}\t${describeEvent(e)}`)
    .join("\n");
}
