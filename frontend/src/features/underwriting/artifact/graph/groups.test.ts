import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { phaseGroups, unfoldedGroups, visibleGraph } from "./groups";
import { layoutGraph } from "./layout";

const spec = graphSpecJson as GraphSpec;
const groups = phaseGroups(spec);
const all = new Set(groups.map((g) => g.id));

describe("phaseGroups", () => {
  it("groups the phases with several executing steps and leaves lone steps alone", () => {
    expect(groups.map((g) => [g.id, g.members.length])).toEqual([
      ["group:fetch", 7],
      ["group:index", 2],
      ["group:assess", 8],
      ["group:cases", 8],
      ["group:quant", 3],
    ]);
    expect(groups.find((g) => g.phase === "cases")!.containers.sort()).toEqual(["bear_case", "bull_case"]);
    expect(groups.find((g) => g.phase === "fetch")!.label).toBe("Gather public evidence");
  });
});

describe("unfoldedGroups", () => {
  it("names the groups that went from folded to open, and only those", () => {
    expect(unfoldedGroups(groups, all, new Set([...all].filter((id) => id !== "group:assess")))).toEqual(["group:assess"]);
    expect(unfoldedGroups(groups, all, new Set())).toEqual(groups.map((g) => g.id));
    expect(unfoldedGroups(groups, new Set(), all)).toEqual([]);
    expect(unfoldedGroups(groups, all, all)).toEqual([]);
  });
});

describe("visibleGraph", () => {
  it("draws one node per group when everything is folded, in pipeline order", () => {
    const { nodes } = visibleGraph(spec, groups, all);
    expect(nodes.map((n) => n.id)).toEqual([
      "input_resolver", "question_planner", "group:fetch", "group:index", "group:assess", "group:cases", "section_analysts", "group:quant", "report_assembler",
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
    expect(nodes).toHaveLength(32);
    expect(edges).toHaveLength(spec.edges.length);
  });

  it("folds one group at a time", () => {
    const { nodes } = visibleGraph(spec, groups, new Set(["group:fetch"]));
    expect(nodes).toHaveLength(32 - 7 + 1);
  });
});

describe("layoutGraph with groups", () => {
  it("lays the folded graph out as a column with the parallel assess and cases groups side by side", () => {
    const { nodes, boxes } = layoutGraph(spec, groups, all);
    expect(nodes).toHaveLength(9);
    expect(boxes).toEqual([]);
    const ys = nodes.map((n) => n.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect(at("group:assess").y).toBe(at("group:cases").y);
    expect(at("group:assess").x).not.toBe(at("group:cases").x);
    const spine = nodes.filter((n) => !["group:assess", "group:cases"].includes(n.id));
    expect(new Set(spine.map((n) => Math.round(n.x + n.w / 2))).size).toBe(1);
  });

  it("frames the unfolded groups, with each pair of lanes inside its own frame", () => {
    const { nodes, boxes } = layoutGraph(spec, groups, new Set());
    expect(nodes).toHaveLength(32);
    expect(boxes.filter((b) => b.kind === "outline")).toHaveLength(5);
    for (const [frame, lanes] of [
      ["outline:group:cases", ["bull_case", "bear_case"]],
      ["outline:group:assess", ["efficacy_assessment", "safety_assessment"]],
    ] as const) {
      const outer = boxes.find((b) => b.id === frame)!;
      for (const id of lanes) {
        const box = boxes.find((b) => b.id === id)!;
        expect(box.x).toBeGreaterThan(outer.x);
        expect(box.y).toBeGreaterThan(outer.y);
        expect(box.x + box.w).toBeLessThan(outer.x + outer.w);
        expect(box.y + box.h).toBeLessThan(outer.y + outer.h);
      }
    }
  });

  it("without groups it is the layout the graph always had", () => {
    const plain = layoutGraph(spec);
    expect(plain.nodes).toHaveLength(32);
    expect(plain.boxes.map((b) => b.id).sort()).toEqual(["bear_case", "bull_case", "efficacy_assessment", "safety_assessment"]);
  });

  it("gives each drawn node a position by id, so a group can say where its steps come from", () => {
    const folded = layoutGraph(spec, groups, all);
    expect(folded.pos["group:fetch"]).toBeDefined();
    expect(folded.pos["fetch_trials"]).toBeUndefined();
  });
});
