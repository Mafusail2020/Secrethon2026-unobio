import { Graph, layout } from "@dagrejs/dagre";
import type { GraphSpec } from "../../../../api/types";
import { containerIds } from "../../graphUtils";

export const NODE_W = 190;
export const NODE_H = 46;
const PAD = 14;
const LABEL_H = 18;

export interface Placed {
  id: string;
  x: number;
  y: number;
}

export interface Box extends Placed {
  w: number;
  h: number;
}

/** Top-down dagre layout of the executing nodes; containers become boxes around their children. */
export function layoutGraph(spec: GraphSpec): { nodes: Placed[]; groups: Box[] } {
  const containers = containerIds(spec);
  const g = new Graph();
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 38, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const runnable = spec.nodes.filter((n) => !containers.has(n.id));
  for (const n of runnable) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of spec.edges) g.setEdge(e.source, e.target);
  layout(g);

  const nodes = runnable.map((n) => {
    const p = g.node(n.id);
    return { id: n.id, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = [...containers].flatMap((id) => {
    const kids = spec.nodes
      .filter((n) => n.parent === id)
      .flatMap((n) => byId.get(n.id) ?? []);
    if (kids.length === 0) return [];
    const x = Math.min(...kids.map((k) => k.x)) - PAD;
    const y = Math.min(...kids.map((k) => k.y)) - PAD - LABEL_H;
    const right = Math.max(...kids.map((k) => k.x + NODE_W)) + PAD;
    const bottom = Math.max(...kids.map((k) => k.y + NODE_H)) + PAD;
    return [{ id, x, y, w: right - x, h: bottom - y }];
  });
  return { nodes, groups };
}
