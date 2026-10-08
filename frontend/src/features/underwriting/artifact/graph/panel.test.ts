import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { containerIds, runnableNodes } from "../../graphUtils";
import { baseId, isPanelist, withoutPanel, withPanel } from "./panel";

const spec = graphSpecJson as GraphSpec;
const analysis = runnableNodes(spec).filter((n) => n.kind === "analysis");

describe("withPanel", () => {
  const out = withPanel(spec, 3);

  it("adds a panel of analysts before every step that makes a model call, and nothing anywhere else", () => {
    expect(analysis.length).toBeGreaterThan(5);
    expect(out.nodes).toHaveLength(spec.nodes.length + analysis.length * 3);
    for (const step of analysis) {
      const found = out.nodes.filter((n) => n.id.startsWith(`${step.id}~`));
      expect(found.map((n) => n.label)).toEqual(["Analyst 1", "Analyst 2", "Analyst 3"]);
      expect(found.every((n) => n.parent === step.parent && n.phase === step.phase)).toBe(true);
    }
    expect(out.nodes.filter((n) => isPanelist(n.id))).toHaveLength(analysis.length * 3);
  });

  it("renames the step itself to the aggregator and keeps its id", () => {
    for (const step of analysis) {
      const node = out.nodes.find((n) => n.id === step.id)!;
      expect(node.label).toBe("Aggregator");
      expect(node.description).toContain(step.label);
      expect(node.description).toContain(step.description);
    }
  });

  it("wires inputs to every analyst and every analyst to the aggregator, never an input straight to the aggregator", () => {
    const step = analysis.find((n) => n.id === "section_analysts")!;
    const into = out.edges.filter((e) => e.target.startsWith("section_analysts~"));
    const sources = spec.edges.filter((e) => e.target === step.id).map((e) => e.source);
    expect(new Set(into.map((e) => e.source))).toEqual(new Set(sources));
    expect(into).toHaveLength(sources.length * 3);
    expect(out.edges.filter((e) => e.target === step.id).map((e) => e.source).sort()).toEqual(["section_analysts~1", "section_analysts~2", "section_analysts~3"]);
    expect(out.edges.filter((e) => e.source === step.id)).toEqual(spec.edges.filter((e) => e.source === step.id));
  });

  it("leaves containers, other steps and the original spec alone", () => {
    expect(containerIds(out)).toEqual(containerIds(spec));
    expect(spec.nodes.some((n) => n.label === "Aggregator")).toBe(false);
    const quant = out.nodes.find((n) => n.id === "valuation")!;
    expect(quant).toEqual(spec.nodes.find((n) => n.id === "valuation"));
  });

  it("skips the steps whose panel could not run", () => {
    const skipped = withPanel(spec, 2, new Set(["section_analysts"]));
    expect(skipped.nodes.some((n) => n.id.startsWith("section_analysts~"))).toBe(false);
    expect(skipped.nodes.find((n) => n.id === "section_analysts")!.label).toBe(spec.nodes.find((n) => n.id === "section_analysts")!.label);
    expect(skipped.nodes.some((n) => n.id === "question_planner~2")).toBe(true);
  });
});

describe("panel ids", () => {
  it("maps an analyst back to its step", () => {
    expect(baseId("section_analysts~2")).toBe("section_analysts");
    expect(baseId("verdict")).toBe("verdict");
    expect(isPanelist("verdict")).toBe(false);
  });

  it("finds the steps that fell back to one call from their logs", () => {
    const logs = { a: [{ message: "warn: panel mode is not available yet; using a single call" }], b: [{ message: "fine" }] };
    expect([...withoutPanel(logs)]).toEqual(["a"]);
  });
});
