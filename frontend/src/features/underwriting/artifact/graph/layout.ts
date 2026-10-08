import { Graph, layout } from "@dagrejs/dagre";
import type { GraphSpec } from "../../../../api/types";
import { containerIds } from "../../graphUtils";
import { type PhaseGroup, visibleGraph } from "./groups";
import { baseId, isPanelist } from "./panel";

export const NODE_W = 196;
export const NODE_H = 50;
export const GROUP_W = 244;
export const GROUP_H = 68;
/** an analyst of a panel is a small step: its answer is the aggregator's to show */
export const PANELIST_W = 112;
export const PANELIST_H = 34;
/** between a frame's border and what it holds */
const PAD = 12;
/** extra room above the content for the frame's title chip, which sits on the top border */
const HEAD = 16;
export const CHIP_H = 22;
const NODESEP = 64;
const RANKSEP = 44;
/** keeps a wire from running under the corner of a title chip */
const CHIP_CLEAR = 14;

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
  /** left edge of the title chip, relative to the frame; chosen so no wire crosses it */
  labelX: number;
  labelW: number;
  /** the one wire into this frame runs through its title chip, which sits on that wire */
  gate: boolean;
}

/**
 * A wire between two drawn nodes: orthogonal, running in the gaps between rows and around the steps. It is more than
 * one polyline when it passes through the title chip of a frame: the part before the chip, and the part after.
 */
export interface Wire {
  id: string;
  source: string;
  target: string;
  paths: Pos[][];
}

export interface GraphLayout {
  nodes: Placed[];
  boxes: Box[];
  wires: Wire[];
  /** top-left of each drawn node, by id */
  pos: Record<string, Pos>;
}

/** Width of a frame's title chip: status icon, label, and the fold arrow. */
export function chipWidth(label: string): number {
  return Math.ceil(36 + label.length * 6.6);
}

interface FrameDef {
  id: string;
  kind: Box["kind"];
  label: string;
  members: string[];
  /** frames inside this one (an unfolded group holds its containers) */
  inner: string[];
}

function union(items: Omit<Placed, "id">[]): Omit<Placed, "id"> {
  const x = Math.min(...items.map((k) => k.x));
  const y = Math.min(...items.map((k) => k.y));
  const right = Math.max(...items.map((k) => k.x + k.w));
  const bottom = Math.max(...items.map((k) => k.y + k.h));
  return { x, y, w: right - x, h: bottom - y };
}

const grow = (r: Omit<Placed, "id">): Omit<Placed, "id"> => ({ x: r.x - PAD, y: r.y - PAD - HEAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD + HEAD });

/**
 * Top-down layout of what is drawn: executing steps, with each folded group as one larger box. Containers become
 * frames around their steps, and so does every group that is unfolded. Dagre ranks and orders the steps; the frame
 * titles and the wires are placed here, so that neither a title nor a step is ever under a wire.
 */
export function layoutGraph(
  spec: GraphSpec,
  groups: PhaseGroup[] = [],
  collapsed: ReadonlySet<string> = new Set(),
): GraphLayout {
  const { nodes: drawn, edges } = visibleGraph(spec, groups, collapsed);
  const drawnIds = new Set(drawn.map((n) => n.id));
  const isGroupBox = (id: string) => !!drawn.find((n) => n.id === id)?.group;
  const size = (id: string) => (isGroupBox(id) ? { w: GROUP_W, h: GROUP_H } : isPanelist(id) ? { w: PANELIST_W, h: PANELIST_H } : { w: NODE_W, h: NODE_H });

  // frames: unfolded groups, and the containers inside them
  const frames: FrameDef[] = [];
  const labelOf = (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id;
  for (const group of groups) {
    if (collapsed.has(group.id)) continue;
    const members = group.members.filter((m) => drawnIds.has(m));
    if (members.length) frames.push({ id: `outline:${group.id}`, kind: "outline", label: group.label, members, inner: group.containers });
  }
  for (const id of containerIds(spec)) {
    const members = spec.nodes.filter((n) => n.parent === id && drawnIds.has(n.id)).map((n) => n.id);
    if (members.length) frames.push({ id, kind: "container", label: labelOf(id), members, inner: [] });
  }

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    preds.set(e.target, [...(preds.get(e.target) ?? []), e.source]);
    succs.set(e.source, [...(succs.get(e.source) ?? []), e.target]);
  }
  const isHead = (id: string, f: FrameDef) => !(preds.get(id) ?? []).some((p) => f.members.includes(p));
  const isTail = (id: string, f: FrameDef) => !(succs.get(id) ?? []).some((s) => f.members.includes(s));

  // each frame's title and padding need room in the row above and below its first and last steps
  const above = new Map<string, number>();
  const below = new Map<string, number>();
  for (const f of frames) {
    for (const m of f.members) {
      if (isHead(m, f)) above.set(m, (above.get(m) ?? 0) + PAD + HEAD);
      if (isTail(m, f)) below.set(m, (below.get(m) ?? 0) + PAD);
    }
  }

  // compound, so that dagre keeps every frame's steps together instead of weaving one frame's through another's
  const g = new Graph({ compound: true });
  g.setGraph({ rankdir: "TB", nodesep: NODESEP, ranksep: RANKSEP, edgesep: 28, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of drawn) {
    const s = size(n.id);
    g.setNode(n.id, { width: s.w, height: s.h + (above.get(n.id) ?? 0) + (below.get(n.id) ?? 0) });
  }
  const containerFrame = new Map(frames.filter((f) => f.kind === "container").flatMap((f) => f.members.map((m) => [m, f.id] as const)));
  const outlineFrame = new Map(frames.filter((f) => f.kind === "outline").flatMap((f) => f.members.map((m) => [m, f.id] as const)));
  for (const f of frames) g.setNode(f.id, {});
  for (const f of frames.filter((x) => x.kind === "container")) {
    const outer = f.members.map((m) => outlineFrame.get(m)).find(Boolean);
    if (outer) g.setParent(f.id, outer);
  }
  for (const n of drawn) {
    const parent = containerFrame.get(n.id) ?? outlineFrame.get(n.id);
    if (parent) g.setParent(n.id, parent);
  }
  // a fork's branches start together instead of the lone one drifting down next to the longest
  for (const e of edges) g.setEdge(e.source, e.target, { weight: (succs.get(e.source)?.length ?? 0) > 1 ? 4 : 1 });
  layout(g);

  const nodes: Placed[] = drawn.map((n) => {
    const p = g.node(n.id);
    const s = size(n.id);
    const top = above.get(n.id) ?? 0;
    const total = s.h + top + (below.get(n.id) ?? 0);
    return { id: n.id, x: p.x - s.w / 2, y: p.y - total / 2 + top, w: s.w, h: s.h };
  });
  // the analysts of a panel read left to right in their own order, whichever way dagre ordered the row
  const panels = new Map<string, Placed[]>();
  for (const n of nodes) if (isPanelist(n.id)) panels.set(baseId(n.id), [...(panels.get(baseId(n.id)) ?? []), n]);
  for (const row of panels.values()) {
    const xs = row.map((n) => n.x).sort((a, b) => a - b);
    [...row].sort((a, b) => Number(a.id.split("~")[1]) - Number(b.id.split("~")[1])).forEach((n, i) => (n.x = xs[i]!));
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // frames, innermost first: a container hugs its steps, a group hugs its containers and its loose steps
  const rects = new Map<string, Omit<Placed, "id">>();
  const boxes: Box[] = [];
  const order = [...frames].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "container" ? -1 : 1));
  for (const f of order) {
    const insideContainers = new Set(
      f.inner.flatMap((c) => spec.nodes.filter((n) => n.parent === c).map((n) => n.id)),
    );
    const content = [
      ...f.inner.flatMap((c) => rects.get(c) ?? []),
      ...f.members.filter((m) => !insideContainers.has(m)).flatMap((m) => byId.get(m) ?? []),
    ];
    let r = grow(union(content));
    // a title wider than the steps it names widens the frame, evenly
    const labelW = chipWidth(f.label);
    const need = labelW + 2 * PAD - r.w;
    if (need > 0) r = { ...r, x: r.x - need / 2, w: r.w + need };
    rects.set(f.id, r);
    boxes.push({ id: f.id, kind: f.kind, ...r, labelX: PAD, labelW, gate: false });
  }

  // a frame with a single way in has its title on that wire; otherwise the title goes where no wire enters
  for (const box of boxes) {
    const f = frames.find((x) => x.id === box.id)!;
    const entries = f.members
      .filter((m) => isHead(m, f) && (preds.get(m) ?? []).length > 0)
      .map((m) => byId.get(m)!.x + byId.get(m)!.w / 2 - box.x)
      .sort((a, b) => a - b);
    if (entries.length === 1) {
      box.gate = true;
      box.labelX = Math.min(Math.max(entries[0]! - box.labelW / 2, PAD), box.w - PAD - box.labelW);
      continue;
    }
    const stops = [PAD, ...entries.flatMap((e) => [e - CHIP_CLEAR, e + CHIP_CLEAR]), box.w - PAD];
    let best: { at: number; room: number } | undefined;
    for (let i = 0; i < stops.length; i += 2) {
      const room = stops[i + 1]! - stops[i]!;
      if (room >= box.labelW) {
        best = { at: stops[i]!, room };
        break;
      }
      if (!best || room > best.room) best = { at: stops[i]!, room };
    }
    box.labelX = best?.at ?? PAD;
  }

  const wires = routeWires(edges, nodes, byId, g, above, below, boxes, frames);
  return { nodes, boxes, wires, pos: Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])) };
}

/**
 * Orthogonal wires. Each runs down from its source, across in the gap between two rows (so it never touches a step),
 * and down again; a wire that skips rows drops through the free corridor dagre reserved for it.
 */
function routeWires(
  edges: { source: string; target: string }[],
  nodes: Placed[],
  byId: Map<string, Placed>,
  g: Graph,
  above: Map<string, number>,
  below: Map<string, number>,
  boxes: Box[],
  frames: FrameDef[],
): Wire[] {
  const rows: { y: number; top: number; bottom: number }[] = [];
  const rowOf = new Map<string, number>();
  for (const n of [...nodes].sort((a, b) => a.y - b.y)) {
    const centre = g.node(n.id).y as number;
    let i = rows.findIndex((r) => Math.abs(r.y - centre) < 1);
    if (i < 0) {
      rows.push({ y: centre, top: Infinity, bottom: -Infinity });
      i = rows.length - 1;
    }
    const row = rows[i]!;
    row.top = Math.min(row.top, n.y - (above.get(n.id) ?? 0));
    row.bottom = Math.max(row.bottom, n.y + n.h + (below.get(n.id) ?? 0));
    rowOf.set(n.id, i);
  }
  const order = rows.map((_, i) => i).sort((a, b) => rows[a]!.y - rows[b]!.y);
  const rank = new Map(order.map((r, i) => [r, i]));
  const sorted = order.map((r) => rows[r]!);
  const rowIndex = (id: string) => rank.get(rowOf.get(id)!)!;
  const channel = (i: number) => (sorted[i]!.bottom + sorted[i + 1]!.top) / 2;

  return edges.map((e) => {
    const s = byId.get(e.source)!;
    const t = byId.get(e.target)!;
    const from = rowIndex(e.source);
    const to = rowIndex(e.target);
    const sx = s.x + s.w / 2;
    const tx = t.x + t.w / 2;
    // dagre's dummy steps tell where the wire may pass each row it skips
    const corridor = new Map<number, number>();
    for (const p of (g.edge(e.source, e.target)?.points ?? []) as Pos[]) {
      const i = sorted.findIndex((r) => Math.abs(r.y - p.y) < 1);
      if (i > from && i < to) corridor.set(i, p.x);
    }
    // the title chips this wire runs through on its way in, outermost first
    const gates = boxes
      .filter((b) => {
        const members = frames.find((f) => f.id === b.id)!.members;
        return b.gate && members.includes(e.target) && !members.includes(e.source) && Math.abs(b.x + b.labelX + b.labelW / 2 - tx) < 1;
      })
      .sort((a, b) => a.y - b.y);
    const endY = gates[0] ? gates[0].y - CHIP_H / 2 : t.y;
    const pts: Pos[] = [{ x: sx, y: s.y + s.h }];
    let x = sx;
    for (let i = from; i < to; i++) {
      const next = i + 1 === to ? tx : (corridor.get(i + 1) ?? x);
      pts.push({ x, y: channel(i) }, { x: next, y: channel(i) });
      x = next;
    }
    pts.push({ x: tx, y: endY });
    const paths = [simplify(pts)];
    gates.forEach((gate, i) => {
      const next = gates[i + 1];
      paths.push([
        { x: tx, y: gate.y + CHIP_H / 2 },
        { x: tx, y: next ? next.y - CHIP_H / 2 : t.y },
      ]);
    });
    return { id: `${e.source}->${e.target}`, source: e.source, target: e.target, paths };
  });
}

/** Drops repeated points and the middle of any three points in a line. */
function simplify(pts: Pos[]): Pos[] {
  const out: Pos[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  return out.filter((p, i) => {
    const a = out[i - 1];
    const b = out[i + 1];
    if (!a || !b) return true;
    return !((Math.abs(a.x - p.x) < 0.01 && Math.abs(p.x - b.x) < 0.01) || (Math.abs(a.y - p.y) < 0.01 && Math.abs(p.y - b.y) < 0.01));
  });
}

/** An SVG path through the points with rounded corners. */
export function roundedPath(points: Pos[], radius = 10): string {
  if (points.length === 0) return "";
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const p = points[i]!;
    const b = points[i + 1]!;
    const r = Math.min(radius, Math.hypot(p.x - a.x, p.y - a.y) / 2, Math.hypot(b.x - p.x, b.y - p.y) / 2);
    const unit = (u: Pos, v: Pos) => {
      const len = Math.hypot(v.x - u.x, v.y - u.y) || 1;
      return { x: (v.x - u.x) / len, y: (v.y - u.y) / len };
    };
    const back = unit(p, a);
    const fwd = unit(p, b);
    d += ` L ${p.x + back.x * r} ${p.y + back.y * r} Q ${p.x} ${p.y} ${p.x + fwd.x * r} ${p.y + fwd.y * r}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}
