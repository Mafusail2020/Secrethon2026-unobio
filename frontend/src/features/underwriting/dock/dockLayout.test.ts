import { describe, expect, it } from "vitest";
import { parseLayout } from "./dockLayout";

const layout = (panels: Record<string, unknown>) =>
  JSON.stringify({ grid: { root: { type: "leaf", data: {} }, width: 800, height: 600, orientation: "HORIZONTAL" }, panels });
const panel = (id: string, component = id) => ({ id, contentComponent: component, title: id });

describe("parseLayout", () => {
  it("accepts a layout that names only our views", () => {
    const parsed = parseLayout(layout({ report: panel("report"), graph: panel("graph") }));
    expect(Object.keys(parsed!.panels)).toEqual(["report", "graph"]);
  });

  it("accepts an empty arrangement, so closing every view is remembered", () => {
    expect(parseLayout(layout({}))).toBeDefined();
  });

  it("ignores anything it did not write or cannot trust", () => {
    expect(parseLayout(undefined)).toBeUndefined();
    expect(parseLayout("not json")).toBeUndefined();
    expect(parseLayout("null")).toBeUndefined();
    expect(parseLayout(JSON.stringify({ panels: {} }))).toBeUndefined(); // no grid
    expect(parseLayout(layout({ chat: panel("chat") }))).toBeUndefined(); // a view we do not have
    expect(parseLayout(layout({ report: panel("report", "graph") }))).toBeUndefined(); // id and component disagree
  });
});
