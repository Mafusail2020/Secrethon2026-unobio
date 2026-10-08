import { Graph, layout } from "@dagrejs/dagre";
import type { GraphSpec } from "../../../../api/types";
import { containerIds } from "../../graphUtils";
import { type PhaseGroup, visibleGraph } from "./groups";

export const NODE_W = 190;
export const NODE_H = 46;
export const GROUP_W = 236;
export const GROUP_H = 66;
const PAD = 14;
const LABEL_H = 18;

export interface Pos {
  x: number;
  y: number;
}

export interface Placed extends Pos {
  id: string;
  w: number;
  h: number;
}

/** A frame around nodes: a container (bull or bear case), or the outline of an unfolded group. */
export interface Box extends Placed {
  kind: "container" | "outline";
}

export interface GraphLayout {
  nodes: Placed[];
  boxes: Box[];
  /** top-left of each drawn node, by id */
  pos: Record<string, Pos>;
}

function bounds(items: Placed[], pad: number): Omit<Placed, "id"> {
  const x = Math.min(...items.map((k) => k.x)) - pad;
  const y = Math.min(...items.map((k) => k.y)) - pad - LABEL_H;
  const right = Math.max(...items.map((k) => k.x + k.w)) + pad;
  const bottom = Math.max(...items.map((k) => k.y + k.h)) + pad;
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Top-down dagre layout of what is drawn: executing steps, with each folded group as one larger box.
 * Containers become frames around their steps, and so does every group that is unfolded.
 */
export function layoutGraph(
  spec: GraphSpec,
  groups: PhaseGroup[] = [],
  collapsed: ReadonlySet<string> = new Set(),
): GraphLayout {
  const { nodes: drawn, edges } = visibleGraph(spec, groups, collapsed);
  const g = new Graph();
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 38, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const size = (id: string) => (drawn.find((n) => n.id === id)?.group ? { w: GROUP_W, h: GROUP_H } : { w: NODE_W, h: NODE_H });
  for (const n of drawn) {
    const s = size(n.id);
    g.setNode(n.id, { width: s.w, height: s.h });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  layout(g);

  const nodes: Placed[] = drawn.map((n) => {
    const p = g.node(n.id);
    const s = size(n.id);
    return { id: n.id, x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const boxes: Box[] = [];
  for (const id of containerIds(spec)) {
    const kids = spec.nodes.filter((n) => n.parent === id).flatMap((n) => byId.get(n.id) ?? []);
    if (kids.length) boxes.push({ id, kind: "container", ...bounds(kids, PAD) });
  }
  for (const group of groups) {
    if (collapsed.has(group.id)) continue;
    const kids = group.members.flatMap((m) => byId.get(m) ?? []);
    if (kids.length) boxes.push({ id: `outline:${group.id}`, kind: "outline", ...bounds(kids, group.containers.length ? PAD * 2 : PAD) });
  }

  return { nodes, boxes, pos: Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])) };
}
