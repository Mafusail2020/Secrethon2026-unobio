import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../contracts/fixtures/graph_spec.json";
import type { components } from "./types.gen";

type GraphSpec = components["schemas"]["GraphSpec"];
const spec = graphSpecJson as GraphSpec;

describe("graph_spec fixture", () => {
  const ids = new Set(spec.nodes.map((n) => n.id));

  it("wires every edge between known nodes", () => {
    for (const edge of spec.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });

  it("has valid parents and a color for every kind", () => {
    for (const node of spec.nodes) {
      if (node.parent) expect(ids.has(node.parent)).toBe(true);
      expect(spec.kind_colors[node.kind]).toBeTruthy();
    }
  });
});
