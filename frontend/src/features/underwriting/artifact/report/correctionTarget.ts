import type { Claim, GraphSpec, NodeSpec } from "../../../../api/types";

export interface CorrectionTarget {
  node: NodeSpec;
  /** shown to the user when the node is not simply claim.produced_by */
  note?: string;
}

const REWRITE: Record<string, string> = {
  bull_claim_gate: "bull_claim_writer",
  bear_claim_gate: "bear_claim_writer",
};

function upstreamCorrectable(spec: GraphSpec, from: string): NodeSpec | undefined {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node?.correctable) return node;
    for (const e of spec.edges) if (e.target === id) queue.push(e.source);
  }
  return undefined;
}

/**
 * Where a "this is wrong" correction should go. A claim gate only re-checks drafted claims, so a correction there
 * can exclude evidence but cannot make the writer reconsider: bull and bear claims go to their writer, which
 * recomputes the gate as well. An unknown or non-correctable producer falls back to the nearest correctable
 * node upstream.
 */
export function correctionTargetFor(claim: Claim, spec: GraphSpec): CorrectionTarget | undefined {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const rewritten = REWRITE[claim.produced_by];
  const direct = byId.get(rewritten ?? claim.produced_by);
  if (direct?.correctable) {
    return rewritten
      ? { node: direct, note: `${claim.produced_by.replace(/_/g, " ")} only re-checks drafts, so the correction goes to ${direct.label} (which recomputes it).` }
      : { node: direct };
  }
  const start = claim.produced_by && byId.has(claim.produced_by) ? claim.produced_by : "section_analysts";
  const fallback = upstreamCorrectable(spec, start);
  if (!fallback) return undefined;
  return {
    node: fallback,
    note: byId.has(claim.produced_by)
      ? `${byId.get(claim.produced_by)!.label} cannot be corrected, so the correction goes to ${fallback.label}.`
      : `This claim was produced by "${claim.produced_by || "unknown"}", which is not a step in the graph, so the correction goes to ${fallback.label}.`,
  };
}
