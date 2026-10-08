import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec } from "../../../../api/types";
import { phaseGroups } from "./groups";
import { CHIP_H, layoutGraph, roundedPath, type Placed, type Pos } from "./layout";

const spec = graphSpecJson as GraphSpec;
const groups = phaseGroups(spec);

// every way of folding and unfolding the groups
const states: Set<string>[] = Array.from({ length: 2 ** groups.length }, (_, mask) => new Set(groups.filter((_, i) => mask & (1 << i)).map((g) => g.id)));

type Rect = { x: number; y: number; w: number; h: number };
const shrink = (r: Rect, by = 1): Rect => ({ x: r.x + by, y: r.y + by, w: r.w - 2 * by, h: r.h - 2 * by });
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const crosses = (a: Pos, b: Pos, r: Rect) =>
  a.x === b.x
    ? a.x > r.x && a.x < r.x + r.w && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h
    : a.y > r.y && a.y < r.y + r.h && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w;

describe.each(states.map((s) => [[...s].sort().join(",") || "all open", s] as const))("layout with %s folded", (_, folded) => {
  const out = layoutGraph(spec, groups, folded);
  const node = (id: string) => out.nodes.find((n) => n.id === id)!;
  const membersOf = (boxId: string): string[] =>
    boxId.startsWith("outline:")
      ? groups.find((g) => `outline:${g.id}` === boxId)!.members
      : spec.nodes.filter((n) => n.parent === boxId).map((n) => n.id);

  it("never lets two steps overlap", () => {
    for (const a of out.nodes) for (const b of out.nodes) if (a.id < b.id) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
  });

  it("frames hold their steps and nothing else, and are nested or apart", () => {
    for (const box of out.boxes) {
      const mine = new Set(membersOf(box.id));
      for (const n of out.nodes) {
        if (mine.has(n.id)) expect(inside(n, box), `${n.id} in ${box.id}`).toBe(true);
        else expect(overlap(n, box), `${n.id} is not in ${box.id}`).toBe(false);
      }
      for (const other of out.boxes) if (other.id < box.id) expect(overlap(box, other) ? inside(box, other) || inside(other, box) : true, `${box.id} and ${other.id}`).toBe(true);
    }
  });

  it("keeps each title chip clear of every step", () => {
    for (const box of out.boxes) {
      const chip = { x: box.x + box.labelX, y: box.y - CHIP_H / 2, w: box.labelW, h: CHIP_H };
      expect(chip.x, box.id).toBeGreaterThanOrEqual(box.x);
      for (const n of out.nodes) expect(overlap(shrink(chip), n), `${box.id} chip and ${n.id}`).toBe(false);
    }
  });

  it("routes every wire square, from its source's bottom to its target's top, past every step and title", () => {
    const chips = out.boxes.map((b) => ({ id: b.id, ...shrink({ x: b.x + b.labelX, y: b.y - CHIP_H / 2, w: b.labelW, h: CHIP_H }) }));
    expect(out.wires.length).toBeGreaterThan(0);
    for (const w of out.wires) {
      const s = node(w.source);
      const t = node(w.target);
      const first = w.paths[0]![0]!;
      const last = w.paths.at(-1)!.at(-1)!;
      expect(first).toEqual({ x: s.x + s.w / 2, y: s.y + s.h });
      expect(last).toEqual({ x: t.x + t.w / 2, y: t.y });
      for (const path of w.paths) {
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]!;
          const b = path[i]!;
          expect(a.x === b.x || a.y === b.y, `${w.id} is not square`).toBe(true);
          for (const n of out.nodes) expect(crosses(a, b, shrink(n)), `${w.id} runs through ${n.id}`).toBe(false);
          for (const c of chips) expect(crosses(a, b, c), `${w.id} runs through the title of ${c.id}`).toBe(false);
        }
      }
    }
  });
});

describe("layout choices", () => {
  const open = layoutGraph(spec, groups, new Set());
  const placed = (id: string): Placed => open.nodes.find((n) => n.id === id)!;

  it("starts the branches of a fork on the same row", () => {
    const heads = ["efficacy_gather", "safety_gather", "bull_query_planner", "bear_query_planner"].map((id) => placed(id).y);
    expect(new Set(heads).size).toBe(1);
    const folded = layoutGraph(spec, groups, new Set(groups.filter((g) => g.id !== "group:assess").map((g) => g.id)));
    expect(folded.nodes.find((n) => n.id === "group:cases")!.y).toBeLessThanOrEqual(folded.nodes.find((n) => n.id === "efficacy_gather")!.y);
  });

  it("puts a frame's title on its only wire, and between the wires when there are several", () => {
    const gate = open.boxes.find((b) => b.id === "efficacy_assessment")!;
    expect(gate.gate).toBe(true);
    expect(gate.x + gate.labelX + gate.labelW / 2).toBeCloseTo(placed("efficacy_gather").x + placed("efficacy_gather").w / 2, 0);
    const many = open.boxes.find((b) => b.id === "outline:group:fetch")!;
    expect(many.gate).toBe(false);
  });

  it("rounds corners without leaving the route", () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }]);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("Q 0 20");
    expect(d.endsWith("L 40 60")).toBe(true);
  });
});
