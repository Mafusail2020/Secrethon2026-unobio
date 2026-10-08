import { Background, Controls, MarkerType, Panel, ReactFlow, useReactFlow, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import type { GraphSpec, NodeStatus } from "../../../../api/types";
import { containerIds } from "../../graphUtils";
import type { RunStream } from "../../reduceEvents";
import { GraphLegend } from "./GraphLegend";
import { kindColor } from "./kindStyle";
import { NODE_H, NODE_W, layoutGraph } from "./layout";
import { ContainerNodeView, SpecNodeView, type GroupFlowNode, type SpecFlowNode } from "./SpecNodes";

const nodeTypes = { spec: SpecNodeView, container: ContainerNodeView };

function groupStatus(children: NodeStatus[]): NodeStatus {
  if (children.length === 0) return "pending";
  if (children.some((s) => s === "failed")) return "failed";
  if (children.some((s) => s === "running")) return "running";
  if (children.every((s) => s === "reused")) return "reused";
  if (children.every((s) => s === "done" || s === "reused" || s === "skipped")) return "done";
  return "pending";
}

/** Pans to the step that is running, so a long run stays in view. */
function FollowRunning({ x, y }: { x: number; y: number }) {
  const flow = useReactFlow();
  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void flow.setCenter(x + NODE_W / 2, y + NODE_H / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: calm ? 0 : 450 });
  }, [flow, x, y]);
  return null;
}

type NodeView = [NodeStatus, number, number];

export function GraphView({
  spec,
  stream,
  selected,
  onSelect,
  sourceCounts,
  highlight,
}: {
  spec: GraphSpec;
  stream: RunStream;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  sourceCounts: Record<string, number>;
  /** while a correction is drafted: the steps that would recompute; everything else dims */
  highlight?: ReadonlySet<string>;
}) {
  const placed = useMemo(() => layoutGraph(spec), [spec]);
  const containers = useMemo(() => containerIds(spec), [spec]);
  const [hovered, setHovered] = useState<string | undefined>();
  const [follow, setFollow] = useState(false);

  // log lines arrive far faster than anything drawn here changes, so rebuild only when a drawn value moves
  const viewKey = JSON.stringify(
    Object.fromEntries(Object.entries(stream.nodes).map(([id, n]) => [id, [n.status, n.durationMs ?? 0, n.llmCalls]])),
  );
  const sourceKey = JSON.stringify(sourceCounts);
  const highlightKey = highlight ? [...highlight].sort().join(",") : "";

  const flowNodes = useMemo(() => {
    const views = JSON.parse(viewKey) as Record<string, NodeView>;
    const sources = JSON.parse(sourceKey) as Record<string, number>;
    const lit = highlightKey ? new Set(highlightKey.split(",")) : undefined;
    const statusOf = (id: string): NodeStatus => views[id]?.[0] ?? "pending";

    const groups: GroupFlowNode[] = placed.groups.map((box) => {
      const node = spec.nodes.find((n) => n.id === box.id)!;
      const kids = spec.nodes.filter((n) => n.parent === box.id).map((n) => n.id);
      const affected = !!lit && kids.some((k) => lit.has(k));
      return {
        id: box.id,
        type: "container",
        position: { x: box.x, y: box.y },
        // sizes are fixed, so declare them: rebuilt node objects would otherwise lose React Flow's measurement and stay hidden
        width: box.w,
        height: box.h,
        zIndex: -1,
        draggable: false,
        data: {
          spec: node,
          color: kindColor(node.kind, spec),
          status: groupStatus(kids.map(statusOf)),
          selected: selected === box.id,
          dim: !!lit && !affected,
          affected,
          w: box.w,
          h: box.h,
        },
      };
    });
    const specs: SpecFlowNode[] = placed.nodes.map((p) => {
      const node = spec.nodes.find((n) => n.id === p.id)!;
      const view = views[p.id];
      const affected = !!lit && lit.has(p.id);
      return {
        id: p.id,
        type: "spec",
        position: { x: p.x, y: p.y },
        width: NODE_W,
        height: NODE_H,
        zIndex: hovered === p.id ? 1000 : 0,
        draggable: false,
        data: {
          spec: node,
          color: kindColor(node.kind, spec),
          status: statusOf(p.id),
          llmCalls: view?.[2] ?? 0,
          sources: sources[p.id],
          durationMs: view?.[1] || undefined,
          selected: selected === p.id,
          dim: !!lit && !affected,
          affected,
        },
      };
    });
    return [...groups, ...specs];
  }, [placed, spec, viewKey, sourceKey, highlightKey, selected, hovered]);

  const edges = useMemo<Edge[]>(() => {
    const views = JSON.parse(viewKey) as Record<string, NodeView>;
    const lit = highlightKey ? new Set(highlightKey.split(",")) : undefined;
    return spec.edges
      .filter((e) => !containers.has(e.source) && !containers.has(e.target))
      .map((e) => ({
        id: `${e.source}->${e.target}`,
        source: e.source,
        target: e.target,
        animated: views[e.target]?.[0] === "running",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#94a3b8", opacity: lit && !(lit.has(e.source) && lit.has(e.target)) ? 0.2 : 1 },
      }));
  }, [spec, containers, viewKey, highlightKey]);

  const runningId = spec.nodes.find((n) => stream.nodes[n.id]?.status === "running" && !containers.has(n.id))?.id;
  const running = follow && runningId ? placed.nodes.find((p) => p.id === runningId) : undefined;

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onNodeMouseEnter={(_, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(undefined)}
      onPaneClick={() => onSelect(undefined)}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.04 }}
      minZoom={0.2}
    >
      <Background />
      <Controls showInteractive={false} />
      <Panel position="top-left">
        <GraphLegend spec={spec} />
      </Panel>
      <Panel position="top-right">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface/95 px-2 py-1 text-xs shadow-sm">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow running step
        </label>
      </Panel>
      {running && <FollowRunning x={running.x} y={running.y} />}
    </ReactFlow>
  );
}
