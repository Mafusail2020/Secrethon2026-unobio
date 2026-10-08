import { useState } from "react";
import type { Claim } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { LabelChip } from "./ClaimChips";
import { STANCE_BAR, STANCE_STYLE, STATUS_STYLE } from "./claimStyles";
import { correctionTargetFor } from "./correctionTarget";
import { EvidenceCard } from "./EvidenceCard";
import { useReportContext } from "./reportContext";

/**
 * A claim with its stance, label and status, expandable to the evidence behind it. `bare` is for a place that already
 * shows the claim's text and frame, such as a row of the report tree: only the details are drawn.
 */
export function ClaimCard({ claim, domId, focused = false, bare = false }: { claim: Claim; domId?: string; focused?: boolean; bare?: boolean }) {
  const { graph, canCorrect, openCorrection, report } = useReportContext();
  const [open, setOpen] = useState(focused);
  const rejected = claim.status === "rejected";
  const target = graph ? correctionTargetFor(claim, graph) : undefined;
  const evidenceCount = claim.evidence_ids.length;

  return (
    <li
      id={domId}
      className={
        bare
          ? `${rejected ? "opacity-70" : ""}`
          : `scroll-mt-32 overflow-hidden rounded-sm border bg-surface [content-visibility:auto] ${
              focused ? "uw-flash border-brand ring-2 ring-brand/30" : "border-line"
            } ${rejected ? "opacity-70" : ""}`
      }
    >
      <div className="flex">
        {!bare && <span className={`w-1 shrink-0 ${STANCE_BAR[claim.stance]}`} aria-hidden="true" />}
        <div className="min-w-0 flex-1 p-2.5">
          {!bare && <p className={`text-sm ${rejected ? "line-through" : ""}`}>{claim.text}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Badge className={STANCE_STYLE[claim.stance]}>{claim.stance === "pro" ? "supports" : claim.stance === "con" ? "against" : "neutral"}</Badge>
            <LabelChip label={claim.label} />
            <Badge className="border-slate-300 text-slate-700">{claim.confidence} confidence</Badge>
            {claim.status !== "accepted" && <Badge className={STATUS_STYLE[claim.status]}>{claim.status}</Badge>}
          </div>
          {claim.rejection_reason && <p className="mt-1 text-xs text-muted">{claim.rejection_reason}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="rounded-full border border-line px-2 py-0.5 hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              {open ? "▾" : "▸"} Evidence ({evidenceCount})
            </button>
            <button
              type="button"
              disabled={!canCorrect || !target}
              onClick={() =>
                target &&
                openCorrection({
                  node: target.node,
                  note: target.note,
                  text: `I disagree with this claim: "${claim.text}"\nBecause: `,
                  exclude: claim.evidence_ids.filter((id) => id in report.evidence),
                })
              }
              title={canCorrect ? "Correct the step that produced this claim and re-run" : "Corrections open once the run has completed"}
              className="rounded-full border border-line px-2 py-0.5 text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            >
              This is wrong
            </button>
          </div>
        </div>
      </div>
      {open && (
        <ul className="space-y-2 border-t border-line bg-canvas/40 p-2.5">
          {evidenceCount === 0 && (
            <li className="text-xs text-muted">
              No evidence cited.{" "}
              {claim.label === "hypothesis" ? "Labelled a hypothesis: the model's own knowledge, to be checked." : ""}
              {claim.label === "unknown" ? "Public evidence could not answer this." : ""}
            </li>
          )}
          {claim.evidence_ids.map((id) => (
            <EvidenceCard key={id} evidenceId={id} claim={claim} />
          ))}
        </ul>
      )}
    </li>
  );
}
