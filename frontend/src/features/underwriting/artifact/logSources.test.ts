import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import reportJson from "../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { RunEvent, UnderwritingReport } from "../../../api/types";
import { describeEvent, eventLevel, filterEvents, groupByNode, noLogFilters, offsetSeconds, toText } from "./logs/logView";
import { buildSourceRows, filterSourceRows, sortRows } from "./sources/sourcesView";

const events = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const report = reportJson as unknown as UnderwritingReport;

const ev = (seq: number, type: RunEvent["type"], node: string | null, data: Record<string, unknown> = {}): RunEvent => ({
  seq, run_id: "r", ts: `2026-01-01T00:00:0${seq}Z`, type, node_id: node, data,
}); // fmt: skip

describe("log view", () => {
  it("derives a level from the event", () => {
    expect(eventLevel(ev(1, "node.failed", "a"))).toBe("error");
    expect(eventLevel(ev(1, "node.skipped", "a"))).toBe("warn");
    expect(eventLevel(ev(1, "node.log", "a", { level: "warn" }))).toBe("warn");
    expect(eventLevel(ev(1, "node.log", "a", { level: "weird" }))).toBe("info");
    expect(eventLevel(ev(1, "llm.call", "a"))).toBe("info");
  });

  it("filters by step, minimum level and text, and combines them", () => {
    const list = [
      ev(1, "node.log", "a", { level: "info", message: "fetching trials" }),
      ev(2, "node.log", "a", { level: "warn", message: "slow response" }),
      ev(3, "node.failed", "b", { error: "boom" }),
    ];
    expect(filterEvents(list, { ...noLogFilters, node: "a" }).map((e) => e.seq)).toEqual([1, 2]);
    expect(filterEvents(list, { ...noLogFilters, minLevel: "warn" }).map((e) => e.seq)).toEqual([2, 3]);
    expect(filterEvents(list, { ...noLogFilters, minLevel: "error" }).map((e) => e.seq)).toEqual([3]);
    expect(filterEvents(list, { ...noLogFilters, query: "TRIALS" }).map((e) => e.seq)).toEqual([1]);
    expect(filterEvents(list, { node: "a", minLevel: "warn", query: "slow" }).map((e) => e.seq)).toEqual([2]);
    expect(filterEvents(list, { ...noLogFilters, query: "nothing like this" })).toEqual([]);
  });

  it("groups by step in order of first appearance with run-level events first", () => {
    const groups = groupByNode([ev(1, "node.started", "b"), ev(2, "run.started", null), ev(3, "node.started", "a"), ev(4, "node.log", "b")]);
    expect(groups.map((g) => [g.node, g.events.length])).toEqual([[null, 1], ["b", 2], ["a", 1]]);
  });

  it("describes events and formats offsets and copied text", () => {
    expect(describeEvent(ev(1, "node.completed", "a", { duration_ms: 1500 }))).toBe("done in 1.5s");
    expect(describeEvent(ev(1, "node.reused", "a", { from_run: "run_x" }))).toBe("reused from run_x");
    expect(offsetSeconds("2026-01-01T00:00:00Z", "2026-01-01T00:00:02.5Z")).toBe("+2.5s");
    const text = toText(events.slice(0, 3));
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("run.started");
  });

  it("works on a whole real event stream", () => {
    expect(filterEvents(events, noLogFilters)).toHaveLength(events.length);
    expect(groupByNode(events)[0]!.node).toBeNull();
  });
});

describe("sources view", () => {
  const rows = buildSourceRows(report);

  it("counts evidence and the claims that cite each source", () => {
    expect(rows).toHaveLength(Object.keys(report.sources).length);
    const trial = rows.find((r) => r.source.identifiers.nct === "NCT01739348")!;
    expect(trial.evidenceCount).toBe(1);
    expect(trial.claimIds.map((id) => report.claims[id]!.text)).toEqual([expect.stringContaining("TERMINATED")]);
    const user = rows.find((r) => r.source.type === "user_provided")!;
    expect(user.claimIds).toHaveLength(1);
  });

  it("sorts by any column in either direction, stably by title", () => {
    const byClaims = sortRows(rows, "claims", "desc");
    expect(byClaims[0]!.claimIds.length).toBeGreaterThanOrEqual(byClaims.at(-1)!.claimIds.length);
    const byTitle = sortRows(rows, "title", "asc").map((r) => r.source.title);
    expect(byTitle).toEqual([...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    expect(sortRows(rows, "title", "desc")[0]!.source.title).toBe(byTitle.at(-1));
    expect(sortRows(rows, "published", "asc")).toHaveLength(rows.length); // sources without a date sort first, never throw
  });

  it("filters by type and by text over title, publisher, url and identifiers", () => {
    expect(filterSourceRows(rows, { type: "trial", query: "" })).toHaveLength(2);
    expect(filterSourceRows(rows, { type: "", query: "nct01953601" })).toHaveLength(1);
    expect(filterSourceRows(rows, { type: "trial", query: "opentargets" })).toEqual([]);
    expect(filterSourceRows(rows, { type: "", query: "" })).toHaveLength(rows.length);
  });
});
