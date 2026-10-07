import { describe, expect, it } from "vitest";
import type { RunSummary } from "../../api/types";
import { groupRuns } from "./history";

const run = (id: string, parent: string | null, at: string) =>
  ({ id, parent_run_id: parent, created_at: at, status: "completed", decision: null }) as unknown as RunSummary;

describe("groupRuns", () => {
  const runs = [
    run("b2", "b", "2026-01-01T10:05:00Z"),
    run("a", null, "2026-01-01T09:00:00Z"),
    run("b", null, "2026-01-01T10:00:00Z"),
    run("b3", "b2", "2026-01-01T10:10:00Z"),
    run("a2", "a", "2026-01-01T09:30:00Z"),
  ];

  it("groups a run with its correction versions, oldest first", () => {
    const groups = groupRuns(runs);
    expect(groups.map((g) => [g.rootId, g.runs.map((r) => r.id)])).toEqual([
      ["b", ["b", "b2", "b3"]],
      ["a", ["a", "a2"]],
    ]);
  });

  it("orders groups by their newest member", () => {
    expect(groupRuns(runs).map((g) => g.latest.id)).toEqual(["b3", "a2"]);
  });

  it("treats a run whose parent is missing from the list as its own root", () => {
    expect(groupRuns([run("c", "gone", "2026-01-01T00:00:00Z")]).map((g) => g.rootId)).toEqual(["c"]);
  });

  it("handles an empty list", () => {
    expect(groupRuns([])).toEqual([]);
  });
});
