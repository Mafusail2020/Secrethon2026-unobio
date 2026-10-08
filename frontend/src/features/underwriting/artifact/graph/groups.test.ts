import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { phaseGroups, visibleGraph } from "./groups";
import { layoutGraph } from "./layout";

const spec = graphSpecJson as GraphSpec;
const groups = phaseGroups(spec);
const all = new Set(groups.map((g) => g.id));

describe("phaseGroups", () => {
  it("groups the phases with several executing steps and leaves lone steps alone", () => {
    expect(groups.map((g) => [g.id, g.members.length])).toEqual([
      ["group:fetch", 6],
      ["group:index", 2],
      ["group:cases", 8],
      ["group:quant", 3],
    ]);
    expect(groups.find((g) => g.phase === "cases")!.containers.sort()).toEqual(["bear_case", "bull_case"]);
    expect(groups.find((g) => g.phase === "fetch")!.label).toBe("Gather public evidence");
  });
});

describe("visibleGraph", () => {
  it("draws one node per group when everything is folded, in pipeline order", () => {
    const { nodes } = visibleGraph(spec, groups, all);
    expect(nodes.map((n) => n.id)).toEqual([
      "input_resolver", "question_planner", "group:fetch", "group:index", "group:cases", "section_analysts", "group:quant", "report_assembler",
    ]); // fmt: skip
  });

  it("rewires edges onto the groups, with no self-links and no duplicates", () => {
    const { nodes, edges, repOf } = visibleGraph(spec, groups, all);
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)).toBe(true);
    expect(new Set(edges.map((e) => `${e.source}->${e.target}`)).size).toBe(edges.length);
    expect(edges).toContainEqual({ source: "question_planner", target: "group:fetch" });
    expect(edges).toContainEqual({ source: "group:fetch", target: "group:index" });
    expect(repOf("fetch_trials")).toBe("group:fetch");
    expect(repOf("input_resolver")).toBe("input_resolver");
  });

  it("is the plain graph when nothing is folded", () => {
    const { nodes, edges } = visibleGraph(spec, groups, new Set());
    expect(nodes).toHaveLength(23);
    expect(edges).toHaveLength(spec.edges.length);
  });

  it("folds one group at a time", () => {
    const { nodes } = visibleGraph(spec, groups, new Set(["group:fetch"]));
    expect(nodes).toHaveLength(23 - 6 + 1);
  });
});

describe("layoutGraph with groups", () => {
  it("lays the folded graph out as one tidy column of eight", () => {
    const { nodes, boxes } = layoutGraph(spec, groups, all);
    expect(nodes).toHaveLength(8);
    expect(boxes).toEqual([]);
    const ys = nodes.map((n) => n.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(nodes.map((n) => Math.round(n.x + n.w / 2))).size).toBe(1);
  });

  it("frames the unfolded groups, with the bull and bear boxes inside the cases frame", () => {
    const { nodes, boxes } = layoutGraph(spec, groups, new Set());
    expect(nodes).toHaveLength(23);
    expect(boxes.filter((b) => b.kind === "outline")).toHaveLength(4);
    const cases = boxes.find((b) => b.id === "outline:group:cases")!;
    for (const id of ["bull_case", "bear_case"]) {
      const box = boxes.find((b) => b.id === id)!;
      expect(box.x).toBeGreaterThan(cases.x);
      expect(box.y).toBeGreaterThan(cases.y);
      expect(box.x + box.w).toBeLessThan(cases.x + cases.w);
      expect(box.y + box.h).toBeLessThan(cases.y + cases.h);
    }
  });

  it("without groups it is the layout the graph always had", () => {
    const plain = layoutGraph(spec);
    expect(plain.nodes).toHaveLength(23);
    expect(plain.boxes.map((b) => b.id).sort()).toEqual(["bear_case", "bull_case"]);
  });

  it("gives each drawn node a position by id, so a group can say where its steps come from", () => {
    const folded = layoutGraph(spec, groups, all);
    expect(folded.pos["group:fetch"]).toBeDefined();
    expect(folded.pos["fetch_trials"]).toBeUndefined();
  });
});
