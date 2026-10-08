import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { KIND_STYLE, kindColor, kindLabel } from "./kindStyle";
import { summarizeOutput } from "./outputSummary";

const spec = graphSpecJson as GraphSpec;

describe("kind styles", () => {
  it("covers every kind the backend graph uses", () => {
    for (const node of spec.nodes) {
      expect(KIND_STYLE[node.kind]).toBeDefined();
      expect(kindColor(node.kind, spec)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("falls back to the backend palette, then to grey, for a kind it does not know", () => {
    const future = { ...spec, kind_colors: { ...spec.kind_colors, future: "#123456" } } as unknown as GraphSpec;
    expect(kindColor("future" as never, future)).toBe("#123456");
    expect(kindColor("other" as never, spec)).toBe("#64748b");
    expect(kindLabel("other")).toBe("other");
  });
});

describe("summarizeOutput", () => {
  it("counts ids and undoes the server's truncation marker", () => {
    const [entry] = summarizeOutput({ source_ids: ["a", "b", "c", "d", "e", "… 7 more"] });
    expect(entry).toEqual({ kind: "ids", key: "source_ids", label: "sources", ids: ["a", "b", "c", "d", "e"], more: 7 });
  });

  it("counts claims from a dict, including the cut marker", () => {
    const claims = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`c${i}`, { text: "x" }]));
    const [full] = summarizeOutput({ claims: { ...claims, "…": "15 more" } });
    expect(full).toMatchObject({ kind: "count", label: "claims", count: 35 });
    const [small] = summarizeOutput({ claims: { a: {}, b: {} } });
    expect(small).toMatchObject({ kind: "count", count: 2 });
  });

  it("counts a list of questions", () => {
    expect(summarizeOutput({ questions: [{}, {}, "… 3 more"] })[0]).toMatchObject({ kind: "count", label: "questions", count: 5 });
  });

  it("leaves unknown keys and shapes as generic values", () => {
    const entries = summarizeOutput({ verdict: { decision: "invest" }, scratch: { n: { a: 1 } }, claims: "weird" });
    expect(entries.map((e) => e.kind)).toEqual(["value", "value", "value"]);
  });

  it("handles an empty output", () => {
    expect(summarizeOutput({})).toEqual([]);
  });
});
