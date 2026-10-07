import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec, RunEvent } from "../../api/types";
import { affectedSet, familyOf, rootOf, runnableNodes } from "./graphUtils";
import { applyEvent, initialStream } from "./reduceEvents";

const events = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const spec = graphSpecJson as GraphSpec;

describe("applyEvent", () => {
  const final = events.reduce(applyEvent, initialStream);

  it("ends with every node done and the run completed", () => {
    expect(final.status).toBe("completed");
    expect(final.decision).toBe("conditional");
    const ids = runnableNodes(spec).map((n) => n.id);
    expect(Object.keys(final.nodes).sort()).toEqual([...ids].sort());
    expect(Object.values(final.nodes).every((n) => n.status === "done")).toBe(true);
  });

  it("collects logs and llm calls per node", () => {
    expect(final.nodes.fetch_trials?.logs.length).toBeGreaterThanOrEqual(2);
    expect(final.nodes.section_analysts?.llmCalls).toBe(1);
  });

  it("is idempotent when a reconnect replays history", () => {
    const replayed = [...events.slice(0, 30), ...events].reduce(applyEvent, initialStream);
    expect(replayed.events.length).toBe(events.length);
    expect(replayed.nodes).toEqual(final.nodes);
  });

  it("tracks running nodes before they complete", () => {
    const partial = events.slice(0, 3).reduce(applyEvent, initialStream);
    expect(partial.status).toBe("running");
    expect(partial.nodes.input_resolver?.status).toBe("running");
  });

  it("marks reused, skipped and failed nodes and failed runs", () => {
    const send = (type: RunEvent["type"], node: string | null, data = {}, seq = 1): RunEvent => ({
      seq,
      run_id: "r",
      ts: "2026-01-01T00:00:00Z",
      type,
      node_id: node,
      data,
    });
    let s = applyEvent(initialStream, send("node.reused", "a", {}, 1));
    s = applyEvent(s, send("node.skipped", "b", { message: "budget" }, 2));
    s = applyEvent(s, send("node.failed", "c", { error: "boom" }, 3));
    s = applyEvent(s, send("run.failed", null, { error: "dead" }, 4));
    expect([s.nodes.a?.status, s.nodes.b?.status, s.nodes.c?.status]).toEqual([
      "reused",
      "skipped",
      "failed",
    ]);
    expect(s.nodes.b?.error).toBe("budget");
    expect(s.status).toBe("failed");
    expect(s.error).toBe("dead");
  });
});

describe("graph utils", () => {
  it("computes the same affected set as the backend", () => {
    expect([...affectedSet(spec, "verdict")].sort()).toEqual(["report_assembler", "verdict"]);
    const bull = affectedSet(spec, "bull_case");
    expect(bull.has("bull_claim_gate") && bull.has("section_analysts")).toBe(true);
    expect(bull.has("bear_claim_gate") || bull.has("bull_case")).toBe(false);
    const writer = affectedSet(spec, "bull_claim_writer");
    expect(writer.has("bull_retriever")).toBe(false);
    expect(writer.has("bull_claim_gate")).toBe(true);
  });

  it("groups runs into correction families", () => {
    const run = (id: string, parent: string | null, at: string) =>
      ({ id, parent_run_id: parent, created_at: at }) as never;
    const runs = [run("c", "b", "3"), run("a", null, "1"), run("b", "a", "2"), run("x", null, "9")];
    expect(rootOf(runs, "c")).toBe("a");
    expect(familyOf(runs, "b").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(familyOf(runs, "x").map((r) => r.id)).toEqual(["x"]);
  });
});
