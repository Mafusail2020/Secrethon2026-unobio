import { BaseEdge, type EdgeProps } from "@xyflow/react";
import type { WireFlowEdge } from "./wires";

/** Draws the route the layout worked out, so a wire never leaves the gaps between rows. */
export function WireEdge({ id, data, markerEnd, style }: EdgeProps<WireFlowEdge>) {
  if (!data) return null;
  return <BaseEdge id={id} path={data.path} markerEnd={markerEnd} style={style} className={`uw-wire uw-wire-${data.state}`} />;
}
