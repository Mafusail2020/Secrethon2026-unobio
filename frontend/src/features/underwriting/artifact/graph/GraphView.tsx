import { Background, Controls, MarkerType, ReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { GraphSpec, NodeStatus } from "../../../../api/types";
import { containerIds } from "../../graphUtils";
import type { RunStream } from "../../reduceEvents";
import { layoutGraph } from "./layout";
import {
  ContainerNodeView,
  SpecNodeView,
  type GroupFlowNode,
  type SpecFlowNode,
} from "./SpecNodes";

const nodeTypes = { spec: SpecNodeView, container: ContainerNodeView };

function groupStatus(children: NodeStatus[]): NodeStatus {
  if (children.length === 0) return "pending";
  if (children.some((s) => s === "failed")) return "failed";
  if (children.some((s) => s === "running")) return "running";
  if (children.every((s) => s === "reused")) return "reused";
  if (children.every((s) => s === "done" || s === "reused" || s === "skipped")) return "done";
  return "pending";
}

export function GraphView({
  spec,
  stream,
  selected,
  onSelect,
}: {
  spec: GraphSpec;
  stream: RunStream;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const placed = useMemo(() => layoutGraph(spec), [spec]);
  const containers = useMemo(() => containerIds(spec), [spec]);

  const flowNodes = useMemo(() => {
    const groups: GroupFlowNode[] = placed.groups.map((box) => {
      const node = spec.nodes.find((n) => n.id === box.id)!;
      const kids = spec.nodes.filter((n) => n.parent === box.id).map((n) => stream.nodes[n.id]?.status ?? "pending");
      return {
        id: box.id,
        type: "container",
        position: { x: box.x, y: box.y },
        zIndex: -1,
        draggable: false,
        data: {
          spec: node,
          color: spec.kind_colors[node.kind],
          status: groupStatus(kids),
          selected: selected === box.id,
          w: box.w,
          h: box.h,
        },
      };
    });
    const specs: SpecFlowNode[] = placed.nodes.map((p) => {
      const node = spec.nodes.find((n) => n.id === p.id)!;
      return {
        id: p.id,
        type: "spec",
        position: { x: p.x, y: p.y },
        draggable: false,
        data: {
          spec: node,
          color: spec.kind_colors[node.kind],
          status: stream.nodes[p.id]?.status ?? "pending",
          llmCalls: stream.nodes[p.id]?.llmCalls ?? 0,
          selected: selected === p.id,
        },
      };
    });
    return [...groups, ...specs];
  }, [placed, spec, stream.nodes, selected]);

  const edges = useMemo<Edge[]>(
    () =>
      spec.edges
        .filter((e) => !containers.has(e.source) && !containers.has(e.target))
        .map((e) => ({
          id: `${e.source}->${e.target}`,
          source: e.source,
          target: e.target,
          animated: stream.nodes[e.target]?.status === "running",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: "#94a3b8" },
        })),
    [spec, containers, stream.nodes],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.04 }}
      minZoom={0.2}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
