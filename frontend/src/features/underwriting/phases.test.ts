import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec, RunEvent } from "../../api/types";
import { currentStep, groupPhases, nowLabel } from "./phases";
import { applyEvent, initialStream } from "./reduceEvents";

const spec = graphSpecJson as GraphSpec;
const events = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const after = (n: number) => events.slice(0, n).reduce(applyEvent, initialStream);

describe("groupPhases", () => {
  it("groups the 32 executing nodes into the pipeline phases in order", () => {
    const phases = groupPhases(spec, {});
    expect(phases.map((p) => p.id)).toEqual([
      "resolve", "plan", "fetch", "index", "assess", "cases", "analyse", "quant", "report",
    ]); // fmt: skip
    expect(phases.reduce((n, p) => n + p.nodes.length, 0)).toBe(32);
    expect(phases.every((p) => p.status === "pending")).toBe(true);
  });

  it("puts bull and bear in two lanes of one phase", () => {
    const cases = groupPhases(spec, {}).find((p) => p.id === "cases")!;
    expect(cases.lanes.map((l) => l.id)).toEqual(["bull_case", "bear_case"]);
    expect(cases.lanes.every((l) => l.nodes.length === 4)).toBe(true);
  });

  it("finishes every phase once the whole run is done, with a wall-clock duration", () => {
    const phases = groupPhases(spec, events.reduce(applyEvent, initialStream).nodes);
    expect(phases.every((p) => p.status === "done")).toBe(true);
    const fetch = phases.find((p) => p.id === "fetch")!;
    expect(fetch.durationMs).toBeGreaterThan(0);
    expect(fetch.llmCalls).toBe(0);
    expect(phases.find((p) => p.id === "analyse")!.llmCalls).toBe(1);
    expect(phases.find((p) => p.id === "fetch")!.lastLog).toContain("FIXTURE");
  });

  it("shows a started phase as running and later phases as pending", () => {
    const phases = groupPhases(spec, after(3).nodes);
    expect(phases[0]!.status).toBe("running");
    expect(phases.slice(1).every((p) => p.status === "pending")).toBe(true);
  });

  it("reports failed and skipped nodes with their reasons", () => {
    const e = (seq: number, type: RunEvent["type"], node: string, data = {}): RunEvent => ({
      seq, run_id: "r", ts: `2026-01-01T00:00:0${seq}Z`, type, node_id: node, data,
    }); // fmt: skip
    let s = applyEvent(initialStream, e(1, "node.started", "fetch_trials"));
    s = applyEvent(s, e(2, "node.failed", "fetch_trials", { error: "ct.gov is down" }));
    s = applyEvent(s, e(3, "node.skipped", "fetch_literature", { message: "run budget reached" }));
    const fetch = groupPhases(spec, s.nodes).find((p) => p.id === "fetch")!;
    expect(fetch.status).toBe("failed");
    expect(fetch.problems.map((p) => [p.nodeId, p.reason])).toEqual([
      ["fetch_trials", "ct.gov is down"],
      ["fetch_literature", "run budget reached"],
    ]);
  });

  it("marks a phase of only reused nodes as reused, and skipped-only as degraded", () => {
    const reused = Object.fromEntries(
      ["input_resolver"].map((id) => [id, { status: "reused" as const, logs: [], llmCalls: 0 }]),
    );
    expect(groupPhases(spec, reused)[0]!.status).toBe("reused");
    const skipped = { input_resolver: { status: "skipped" as const, logs: [], llmCalls: 0 } };
    expect(groupPhases(spec, skipped)[0]!.status).toBe("degraded");
  });

  it("puts an unknown node id in the other phase", () => {
    const extra: GraphSpec = {
      ...spec,
      nodes: [...spec.nodes, { id: "new_node", label: "New", kind: "analysis", description: "x", reads: [], writes: [], parent: null, phase: null, correctable: true, critical: false }],
    }; // fmt: skip
    const phases = groupPhases(extra, {});
    expect(phases.at(-1)).toMatchObject({ id: "other" });
  });
});

describe("usage and stub tracking", () => {
  const call = (seq: number, data: Record<string, unknown>): RunEvent => ({
    seq, run_id: "r", ts: "2026-01-01T00:00:00Z", type: "llm.call", node_id: "n", data,
  }); // fmt: skip

  it("sums tokens and cost, counts cached calls without charging them", () => {
    let s = applyEvent(initialStream, call(1, { model: "m", tokens_in: 100, tokens_out: 20, cost_usd: 0.01, cached: false }));
    s = applyEvent(s, call(2, { model: "m", tokens_in: 100, tokens_out: 20, cost_usd: 0, cached: true }));
    s = applyEvent(s, call(3, { model: "m", tokens_in: 50, tokens_out: 10, cost_usd: 0.005, cached: false }));
    expect(s.usage).toEqual({ calls: 3, cached: 1, tokensIn: 150, tokensOut: 30, costUsd: 0.015, mock: false });
  });

  it("turns the cost unknown, and keeps it unknown, when a paid call has no price", () => {
    let s = applyEvent(initialStream, call(1, { model: "m", tokens_in: 10, tokens_out: 1, cost_usd: null, cached: false }));
    s = applyEvent(s, call(2, { model: "m", tokens_in: 10, tokens_out: 1, cost_usd: 0.5, cached: false }));
    expect(s.usage.costUsd).toBeNull();
    expect(s.usage.tokensIn).toBe(20);
  });

  it("recognises mock models and fixture placeholder logs", () => {
    let s = applyEvent(initialStream, call(1, { model: "mock/gpt-6-luna", tokens_in: 0, tokens_out: 0, cost_usd: 0, cached: false }));
    expect(s.usage.mock).toBe(true);
    expect(s.stubData).toBe(false);
    s = applyEvent(s, { seq: 2, run_id: "r", ts: "2026-01-01T00:00:00Z", type: "node.log", node_id: "n", data: { message: "FIXTURE: no real lookup" } });
    expect(s.stubData).toBe(true);
  });
});

describe("phase from the spec", () => {
  it("uses the phase a node declares over the built-in id map", () => {
    const moved: GraphSpec = { ...spec, nodes: spec.nodes.map((n) => (n.id === "verdict" ? { ...n, phase: "report" as const } : n)) };
    const phases = groupPhases(moved, {});
    expect(phases.find((p) => p.id === "report")!.nodes.map((n) => n.id)).toEqual(["verdict", "report_assembler"]);
    expect(phases.find((p) => p.id === "quant")!.nodes.map((n) => n.id)).not.toContain("verdict");
  });

  it("falls back to the id map when a spec declares no phase", () => {
    const bare: GraphSpec = { ...spec, nodes: spec.nodes.map((n) => ({ ...n, phase: null })) };
    expect(groupPhases(bare, {}).map((p) => p.id)).toEqual(groupPhases(spec, {}).map((p) => p.id));
  });
});

describe("current step", () => {
  it("names the phase and the steps running in it, and nothing once the run is over", () => {
    // the first events start the input resolver, so the first phase is the one running
    const early = after(3);
    const step = currentStep(groupPhases(spec, early.nodes), early.nodes);
    expect(step.phase).toBe("Understand the program");
    expect(step.tools).toEqual(["Input resolver"]);

    const done = events.reduce(applyEvent, initialStream);
    expect(currentStep(groupPhases(spec, done.nodes), done.nodes)).toEqual({ tools: [] });
  });

  it("writes it as one short line and caps the list of steps", () => {
    expect(nowLabel({ phase: "Gather public evidence", tools: ["openFDA"] })).toBe("Gather public evidence: openFDA");
    expect(nowLabel({ phase: "Gather public evidence", tools: ["a", "b", "c", "d", "e"] })).toBe("Gather public evidence: a, b, c +2");
    expect(nowLabel({ phase: "Plan the questions", tools: [] })).toBe("Plan the questions");
    expect(nowLabel({ tools: [] })).toBe("Working");
  });
});
