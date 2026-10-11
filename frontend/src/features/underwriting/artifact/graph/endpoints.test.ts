import { adoptUserNodes, type InternalNodeBase, type NodeBase } from "@xyflow/system";
import { describe, expect, it } from "vitest";
import { endpoints } from "./endpoints";
import { GROUP_H, GROUP_W, NODE_H, NODE_W } from "./layout";

/** What React Flow keeps of a node after the page hands it a freshly built object, as it does on every tick of a run. */
function adopt(node: NodeBase, lookup = new Map<string, InternalNodeBase>()) {
  adoptUserNodes([node], lookup, new Map(), { checkEquality: false });
  return lookup.get(node.id)!;
}

const plain = (id: string, w: number, h: number): NodeBase => ({ id, position: { x: 0, y: 0 }, width: w, height: h, data: {} });

describe("the wires' ends on a step", () => {
  it("are lost with a node object that only states its size: this is why wires vanished", () => {
    expect(adopt(plain("section_analysts", NODE_W, NODE_H)).internals.handleBounds).toBeUndefined();
  });

  it("are kept when the node declares them, however many times the node object is rebuilt", () => {
    const lookup = new Map<string, InternalNodeBase>();
    for (let tick = 0; tick < 3; tick++) {
      const node = { ...plain("section_analysts", NODE_W, NODE_H), ...endpoints(NODE_W, NODE_H), data: { tick } };
      const bounds = adopt(node, lookup).internals.handleBounds;
      expect(bounds?.source).toHaveLength(1);
      expect(bounds?.target).toHaveLength(1);
    }
  });

  it("sit on the middle of the top edge (in) and the bottom edge (out), for a step and for a folded group", () => {
    for (const [w, h] of [[NODE_W, NODE_H], [GROUP_W, GROUP_H]] as const) {
      const { handles } = endpoints(w, h);
      const inn = handles.find((x) => x.type === "target")!;
      const out = handles.find((x) => x.type === "source")!;
      expect(inn.x + (inn.width ?? 0) / 2).toBe(w / 2);
      expect(out.x + (out.width ?? 0) / 2).toBe(w / 2);
      expect(inn.y + (inn.height ?? 0) / 2).toBe(0);
      expect(out.y + (out.height ?? 0) / 2).toBe(h);
    }
  });
});
