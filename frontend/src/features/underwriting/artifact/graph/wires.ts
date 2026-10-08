import type { Edge } from "@xyflow/react";
import type { NodeStatus } from "../../../../api/types";

/** What a wire says about the run: waiting, carried (its source finished), in flight (its target is running), failed, or reused. */
export type WireState = "pending" | "done" | "active" | "failed" | "reused";

// literal colours: SVG markers cannot read CSS variables, and the wire and its arrowhead must match
export const WIRE_COLOR: Record<WireState, string> = {
  pending: "#8793b3",
  done: "#34489f",
  active: "#2f55b5",
  failed: "#dc2626",
  reused: "#5b7bd0",
};

export type WireData = { path: string; state: WireState } & Record<string, unknown>;
export type WireFlowEdge = Edge<WireData, "wire">;

const finished = (s: NodeStatus) => s === "done" || s === "reused" || s === "skipped";

export function wireState(source: NodeStatus, target: NodeStatus): WireState {
  if (source === "failed" || target === "failed") return "failed";
  if (target === "running") return "active";
  if (source === "reused" && (target === "reused" || target === "pending")) return "reused";
  if (finished(source)) return "done";
  return "pending";
}
