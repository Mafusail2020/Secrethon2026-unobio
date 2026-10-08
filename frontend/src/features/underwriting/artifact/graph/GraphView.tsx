import { Background, Controls, MarkerType, Panel, ReactFlow, useReactFlow, useStore, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { GraphSpec, NodeStatus } from "../../../../api/types";
import { readPref, writePref } from "../../../../lib/storage";
import { containerIds } from "../../graphUtils";
import type { RunStream } from "../../reduceEvents";
import { GraphLegend } from "./GraphLegend";
import { isGroupId, phaseGroups, visibleGraph, type PhaseGroup } from "./groups";
import { kindColor } from "./kindStyle";
import { GROUP_H, GROUP_W, NODE_H, NODE_W, PANELIST_H, PANELIST_W, layoutGraph, roundedPath, type Pos } from "./layout";
import { baseId, isPanelist } from "./panel";
import {
  ContainerNodeView,
  OutlineNodeView,
  PhaseGroupNodeView,
  SpecNodeView,
  type GroupFlowNode,
  type OutlineFlowNode,
  type PhaseFlowNode,
  type SpecFlowNode,
} from "./SpecNodes";
import { WireEdge } from "./WireEdge";
import { WIRE_COLOR, wireState, type WireFlowEdge } from "./wires";

const edgeTypes = { wire: WireEdge };
const nodeTypes = { spec: SpecNodeView, container: ContainerNodeView, phase: PhaseGroupNodeView, outline: OutlineNodeView };

const PREF_GROUPS = "uw.graphCollapsed";
const SETTLE_MS = 420;
/** room at the top for the buttons that float over the graph */
const FIT = { padding: { top: "56px", right: "16px", bottom: "16px", left: "16px" } } as const;

function groupStatus(children: NodeStatus[]): NodeStatus {
  if (children.length === 0) return "pending";
  if (children.some((s) => s === "failed")) return "failed";
  if (children.some((s) => s === "running")) return "running";
  if (children.every((s) => s === "reused")) return "reused";
  if (children.every((s) => s === "done" || s === "reused" || s === "skipped")) return "done";
  return "pending";
}

/** Which phases start folded: all of them, unless the reader left some unfolded last time. */
function initialCollapsed(groups: PhaseGroup[]): Set<string> {
  const saved = readPref(PREF_GROUPS);
  if (saved) {
    try {
      const ids = JSON.parse(saved) as unknown;
      if (Array.isArray(ids)) return new Set(groups.filter((g) => ids.includes(g.id)).map((g) => g.id));
    } catch {
      /* fall back to all folded */
    }
  }
  return new Set(groups.map((g) => g.id));
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

/** Fits the graph again when its window changes size (a dock panel moved or resized), until the reader pans or zooms. */
function FitOnResize({ touched }: { touched: RefObject<boolean> }) {
  const { fitView } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  useEffect(() => {
    if (!touched.current) void fitView({ ...FIT, duration: 0 });
  }, [width, height, fitView, touched]);
  return null;
}

/** Brings the whole graph back into view, smoothly, after groups fold or unfold (unless the reader has taken the camera). */
function FitOnRegroup({ layoutKey, ready, touched }: { layoutKey: string; ready: boolean; touched: RefObject<boolean> }) {
  const { fitView } = useReactFlow();
  const done = useRef(layoutKey);
  useEffect(() => {
    // `ready`: the steps have left the group's position, so the bounds being fitted are the real ones
    if (!ready || done.current === layoutKey) return;
    done.current = layoutKey;
    if (touched.current) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void fitView({ ...FIT, duration: calm ? 0 : SETTLE_MS - 60 });
  }, [layoutKey, ready, fitView, touched]);
  return null;
}

export function GraphView({
  spec,
  stream,
  selected,
  onSelect,
  sourceCounts,
  highlight,
  base,
}: {
  /** what is drawn: the pipeline, with a run's panel analysts added */
  spec: GraphSpec;
  /** the pipeline itself, to name the step an aggregator or an analyst stands for */
  base?: GraphSpec;
  stream: RunStream;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
  sourceCounts: Record<string, number>;
  /** while a correction is drafted: the steps that would recompute; everything else dims */
  highlight?: ReadonlySet<string>;
}) {
  const groups = useMemo(() => phaseGroups(spec), [spec]);
  const containers = useMemo(() => containerIds(spec), [spec]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => initialCollapsed(groups));
  const drawing = useMemo(() => layoutGraph(spec, groups, collapsed), [spec, groups, collapsed]);
  const visible = useMemo(() => visibleGraph(spec, groups, collapsed), [spec, groups, collapsed]);
  const [hovered, setHovered] = useState<string | undefined>();
  const [follow, setFollow] = useState(false);
  const touched = useRef(false);
  const gesture = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);

  // The dissolve. Steps coming out of a group start at the box (and invisible), then move to their places; steps going
  // into one are drawn at the box while they fade; the old box stays for a moment and fades. Positions animate by CSS.
  const [spawn, setSpawn] = useState<Record<string, Pos>>({});
  const [leaving, setLeaving] = useState<Record<string, Pos>>({});
  const [ghosts, setGhosts] = useState<Record<string, Pos>>({});
  const [epoch, setEpoch] = useState(0);
  const [settling, setSettling] = useState(false);
  const regroup = useCallback(
    (next: ReadonlySet<string>, byButton = false) => {
      const before = drawing;
      const after = layoutGraph(spec, groups, next);
      const nextSpawn: Record<string, Pos> = {};
      const nextLeaving: Record<string, Pos> = {};
      const nextGhosts: Record<string, Pos> = {};
      for (const g of groups) {
        const was = collapsed.has(g.id);
        if (was === next.has(g.id)) continue;
        if (was) {
          const from = before.pos[g.id];
          if (!from) continue;
          nextGhosts[g.id] = from;
          for (const m of g.members) nextSpawn[m] = from;
        } else {
          const to = after.pos[g.id];
          if (!to) continue;
          nextSpawn[g.id] = to;
          for (const m of g.members) nextLeaving[m] = to;
        }
      }
      if (byButton) touched.current = false;
      setSpawn(nextSpawn);
      setLeaving(nextLeaving);
      setGhosts(nextGhosts);
      setCollapsed(next);
      setSettling(true);
      setEpoch((e) => e + 1);
      writePref(PREF_GROUPS, JSON.stringify([...next]));
    },
    [spec, groups, collapsed, drawing],
  );

  // one frame at the starting place, then let go so the move is a transition
  useEffect(() => {
    if (!Object.keys(spawn).length) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSpawn({}));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [spawn]);
  useEffect(() => {
    if (!epoch) return;
    const timer = window.setTimeout(() => {
      setSettling(false);
      setLeaving({});
      setGhosts({});
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [epoch]);

  // a step that is picked from elsewhere (a link in a drawer) is not left hidden inside a folded box
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    // only for a new pick: folding a group by hand, with its step's drawer still open, is not undone
    if (!selected || revealed.current === selected) return;
    revealed.current = selected;
    const group = groups.find((g) => g.members.includes(selected));
    if (!group || !collapsed.has(group.id)) return;
    const frame = requestAnimationFrame(() => regroup(new Set([...collapsed].filter((id) => id !== group.id))));
    return () => cancelAnimationFrame(frame);
  }, [selected, groups, collapsed, regroup]);

  // log lines arrive far faster than anything drawn here changes, so rebuild only when a drawn value moves
  const viewKey = JSON.stringify(
    Object.fromEntries(Object.entries(stream.nodes).map(([id, n]) => [id, [n.status, n.durationMs ?? 0, n.llmCalls]])),
  );
  const sourceKey = JSON.stringify(sourceCounts);
  const highlightKey = highlight ? [...highlight].sort().join(",") : "";

  // the steps a correction would recompute, with the analysts of any panel in front of them
  const lit = useMemo(() => {
    if (!highlightKey) return undefined;
    const ids = new Set(highlightKey.split(","));
    return new Set(spec.nodes.filter((n) => ids.has(baseId(n.id))).map((n) => n.id));
  }, [highlightKey, spec]);

  const flowNodes = useMemo(() => {
    const views = JSON.parse(viewKey) as Record<string, NodeView>;
    const sources = JSON.parse(sourceKey) as Record<string, number>;
    const statusOf = (id: string): NodeStatus => views[baseId(id)]?.[0] ?? "pending";
    const labelOf = (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id;
    const out: Node[] = [];
    const used = new Set<string>();
    const push = (node: Node) => {
      if (used.has(node.id)) return;
      used.add(node.id);
      out.push(node);
    };

    for (const box of drawing.boxes) {
      if (box.kind === "container") {
        const node = spec.nodes.find((n) => n.id === box.id)!;
        const kids = spec.nodes.filter((n) => n.parent === box.id).map((n) => n.id);
        const affected = !!lit && kids.some((k) => lit.has(k));
        const flow: GroupFlowNode = {
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
            labelX: box.labelX,
            labelW: box.labelW,
            gate: box.gate,
          },
        };
        push(flow);
      } else {
        const group = groups.find((g) => `outline:${g.id}` === box.id)!;
        const affected = !!lit && group.members.some((m) => lit.has(m));
        const flow: OutlineFlowNode = {
          id: box.id,
          type: "outline",
          position: { x: box.x, y: box.y },
          width: box.w,
          height: box.h,
          zIndex: -2,
          draggable: false,
          data: {
            group,
            color: kindColor(spec.nodes.find((n) => n.id === group.members[0])!.kind, spec),
            status: groupStatus(group.members.map(statusOf)),
            w: box.w,
            h: box.h,
            labelX: box.labelX,
            labelW: box.labelW,
            gate: box.gate,
            dim: !!lit && !affected,
            affected,
          },
        };
        push(flow);
      }
    }

    const specNode = (id: string, at: Pos, flags: { entering?: boolean; exiting?: boolean }): SpecFlowNode => {
      const node = spec.nodes.find((n) => n.id === id)!;
      const panelist = isPanelist(id);
      const view = panelist ? undefined : views[id];
      const affected = !!lit && lit.has(id);
      const baseNode = base?.nodes.find((n) => n.id === baseId(id));
      return {
        id,
        type: "spec",
        position: { x: at.x, y: at.y },
        width: panelist ? PANELIST_W : NODE_W,
        height: panelist ? PANELIST_H : NODE_H,
        zIndex: hovered === id ? 1000 : 0,
        draggable: false,
        data: {
          spec: node,
          color: kindColor(node.kind, spec),
          status: statusOf(id),
          llmCalls: view?.[2] ?? 0,
          sources: sources[id],
          durationMs: view?.[1] || undefined,
          selected: selected === id,
          dim: !!lit && !affected,
          affected,
          compact: panelist,
          subtitle: baseNode && baseNode.label !== node.label ? baseNode.label : undefined,
          ...flags,
        },
      };
    };

    const groupNode = (group: PhaseGroup, at: Pos, flags: { entering?: boolean; exiting?: boolean }): PhaseFlowNode => {
      const affected = !!lit && group.members.some((m) => lit.has(m));
      const statuses = group.members.map(statusOf);
      const dominant = spec.nodes.find((n) => n.id === group.members[0])!.kind;
      return {
        id: group.id,
        type: "phase",
        position: { x: at.x, y: at.y },
        width: GROUP_W,
        height: GROUP_H,
        zIndex: hovered === group.id ? 1000 : 0,
        draggable: false,
        data: {
          group,
          color: kindColor(dominant, spec),
          status: groupStatus(statuses),
          done: statuses.filter((s) => s === "done" || s === "reused" || s === "skipped").length,
          total: group.members.length,
          running: group.members.filter((m) => statusOf(m) === "running").map(labelOf),
          dim: !!lit && !affected,
          affected,
          entering: !!flags.entering,
          exiting: !!flags.exiting,
        },
      };
    };

    for (const p of drawing.nodes) {
      const at = spawn[p.id] ?? p;
      const flags = { entering: p.id in spawn };
      const group = isGroupId(p.id) ? groups.find((g) => g.id === p.id) : undefined;
      push(group ? groupNode(group, at, flags) : specNode(p.id, at, flags));
    }
    for (const [id, at] of Object.entries(ghosts)) {
      const group = groups.find((g) => g.id === id);
      if (group) push(groupNode(group, at, { exiting: true }));
    }
    for (const [id, at] of Object.entries(leaving)) push(specNode(id, at, { exiting: true }));
    // one fixed order whatever is drawn: a node that React has to move in the list loses its transition
    const rank = new Map([...groups.map((g) => `outline:${g.id}`), ...spec.nodes.map((n) => n.id), ...groups.map((g) => g.id)].map((id, i) => [id, i]));
    return out.sort((x, y) => (rank.get(x.id) ?? 0) - (rank.get(y.id) ?? 0));
  }, [drawing, spec, base, groups, spawn, ghosts, leaving, viewKey, sourceKey, lit, selected, hovered]);

  const edges = useMemo<WireFlowEdge[]>(() => {
    const views = JSON.parse(viewKey) as Record<string, NodeView>;
    const litReps = lit ? new Set([...lit].map(visible.repOf)) : undefined;
    const statusOf = (id: string): NodeStatus => {
      const group = isGroupId(id) ? groups.find((g) => g.id === id) : undefined;
      return group ? groupStatus(group.members.map((m) => views[baseId(m)]?.[0] ?? "pending")) : (views[baseId(id)]?.[0] ?? "pending");
    };
    return drawing.wires.map((w) => {
      const state = wireState(statusOf(w.source), statusOf(w.target));
      return {
        id: w.id,
        type: "wire",
        source: w.source,
        target: w.target,
        selectable: false,
        focusable: false,
        data: { path: w.paths.map((p) => roundedPath(p)).join(" "), state },
        markerEnd: { type: MarkerType.ArrowClosed, color: WIRE_COLOR[state], width: 14, height: 14 },
        style: {
          // while boxes move the lines would run ahead of them, so they come back once everything has settled
          opacity: settling ? 0 : litReps && !(litReps.has(w.source) && litReps.has(w.target)) ? 0.2 : 1,
          transition: "opacity 250ms",
        },
      };
    });
  }, [drawing, visible, groups, viewKey, lit, settling]);

  const runningId = spec.nodes.find((n) => stream.nodes[n.id]?.status === "running" && !containers.has(n.id))?.id;
  const runningRep = runningId ? visible.repOf(runningId) : undefined;
  const running = follow && runningRep ? drawing.nodes.find((p) => p.id === runningRep) : undefined;
  const allFolded = groups.length > 0 && groups.every((g) => collapsed.has(g.id));
  const noneFolded = collapsed.size === 0;

  return (
    <ReactFlow
      className="uw-graph"
      nodes={flowNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(event, node) => {
        // an analyst of a panel opens the step it answers for
        if (node.type === "spec" || node.type === "container") return onSelect(baseId(node.id));
        const group = groups.find((g) => g.id === node.id || `outline:${g.id}` === node.id);
        if (!group) return;
        if (node.type === "phase") regroup(new Set([...collapsed].filter((id) => id !== group.id)));
        // an unfolded frame is mostly empty space between its steps: only its title folds it
        else if (node.type === "outline" && (event.target as HTMLElement).closest("[data-fold]")) regroup(new Set([...collapsed, group.id]));
      }}
      onNodeMouseEnter={(_, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(undefined)}
      onPaneClick={() => onSelect(undefined)}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={FIT}
      onMoveStart={(event, viewport) => {
        if (event) gesture.current = viewport; // by hand: fitting by code passes no event
      }}
      onMoveEnd={(event, viewport) => {
        // a click on a step also starts and ends a "move"; it only counts when the view really changed
        const from = gesture.current;
        gesture.current = undefined;
        if (event && from && (Math.abs(from.x - viewport.x) > 1 || Math.abs(from.y - viewport.y) > 1 || Math.abs(from.zoom - viewport.zoom) > 0.001)) {
          touched.current = true;
        }
      }}
      minZoom={0.2}
    >
      <Background />
      <FitOnResize touched={touched} />
      <FitOnRegroup layoutKey={[...collapsed].sort().join(",")} ready={Object.keys(spawn).length === 0} touched={touched} />
      <Controls showInteractive={false} />
      <Panel position="top-left">
        <div className="flex flex-wrap items-start gap-1.5">
          <GraphLegend spec={spec} />
          {groups.length > 0 && (
            <>
              <button type="button" onClick={() => regroup(new Set(groups.map((g) => g.id)), true)} disabled={allFolded} className="rounded-lg border border-line bg-surface/95 px-2 py-1 text-xs shadow-sm transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-50 disabled:hover:border-line">
                Group all
              </button>
              <button type="button" onClick={() => regroup(new Set(), true)} disabled={noneFolded} className="rounded-lg border border-line bg-surface/95 px-2 py-1 text-xs shadow-sm transition-colors hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-50 disabled:hover:border-line">
                Ungroup all
              </button>
            </>
          )}
        </div>
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
