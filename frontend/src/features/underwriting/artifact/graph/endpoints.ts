import { Position, type NodeHandle } from "@xyflow/react";

const HANDLE = 6;

/**
 * Where a step's wires meet it: the middle of its top and bottom edge, declared on the node itself. Left to the browser to
 * measure, they are lost each time a node object is rebuilt (which is every status or timer tick), React Flow then draws no
 * wire to or from that node, and it stays gone until the next resize of the node, which a node of fixed size never has.
 */
export function endpoints(w: number, h: number): { measured: { width: number; height: number }; handles: NodeHandle[] } {
  return {
    measured: { width: w, height: h },
    handles: [
      { type: "target", position: Position.Top, x: w / 2 - HANDLE / 2, y: -HANDLE / 2, width: HANDLE, height: HANDLE },
      { type: "source", position: Position.Bottom, x: w / 2 - HANDLE / 2, y: h - HANDLE / 2, width: HANDLE, height: HANDLE },
    ],
  };
}
