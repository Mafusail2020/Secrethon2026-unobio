import type { Claim, Decision, Range, ReportDiff, SectionId, UnderwritingReport } from "../../../../api/types";
import { humanize } from "../../../../lib/format";

export interface DiffView {
  decisionBefore: Decision | null;
  decisionAfter: Decision | null;
  decisionChanged: boolean;
  posBefore: Range | null;
  posAfter: Range | null;
  /** change in the base probability, in absolute points (0.02 = two points) */
  posDelta: number | null;
  sections: { id: SectionId; title: string }[];
  added: Claim[];
  removed: Claim[];
  recomputedNodes: string[];
  /** nothing the reader cares about changed */
  unchanged: boolean;
}

const stub = (id: string): Claim => ({
  id,
  text: id,
  section: "risks",
  stance: "neutral",
  label: "unknown",
  evidence_ids: [],
  confidence: "low",
  produced_by: "",
  status: "accepted",
  rejection_reason: null,
});

/** Added claims come from the new report and removed ones from the old one; ids missing from both stay as ids. */
export function buildDiffView(
  diff: ReportDiff,
  before: UnderwritingReport | undefined,
  after: UnderwritingReport | undefined,
): DiffView {
  const decisionChanged = diff.decision_before !== diff.decision_after;
  const posDelta = diff.pos_before && diff.pos_after ? diff.pos_after.base - diff.pos_before.base : null;
  const sections = diff.changed_sections.map((id) => ({
    id,
    title: after?.sections[id]?.title ?? before?.sections[id]?.title ?? humanize(id),
  }));
  const added = diff.added_claim_ids.map((id) => after?.claims[id] ?? stub(id));
  const removed = diff.removed_claim_ids.map((id) => before?.claims[id] ?? stub(id));
  return {
    decisionBefore: diff.decision_before,
    decisionAfter: diff.decision_after,
    decisionChanged,
    posBefore: diff.pos_before,
    posAfter: diff.pos_after,
    posDelta,
    sections,
    added,
    removed,
    recomputedNodes: diff.recomputed_nodes,
    unchanged:
      !decisionChanged &&
      (posDelta === null || Math.abs(posDelta) < 1e-9) &&
      sections.length === 0 &&
      added.length === 0 &&
      removed.length === 0,
  };
}
