import { useState } from "react";
import type { Claim } from "../../../../../api/types";
import { ClaimCard } from "../ClaimCard";
import { STANCE_BAR } from "../claimStyles";
import { Chevron } from "./Chevron";

const DOTS: Record<Claim["confidence"], string> = { high: "●●●", medium: "●●○", low: "●○○" };

/** One claim as a line: its stance, its text, how sure we are. Opens to the evidence, the sources and the correction. */
export function ClaimRow({ claim, focused = false }: { claim: Claim; focused?: boolean }) {
  const [open, setOpen] = useState(focused);
  const rejected = claim.status === "rejected";
  return (
    <li
      id={`tree-claim-${claim.id}`}
      className={`scroll-mt-32 overflow-hidden rounded-lg border bg-surface ${focused ? "uw-flash border-brand ring-2 ring-brand/30" : "border-line"}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 p-2.5 text-left hover:bg-canvas/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STANCE_BAR[claim.stance]}`} aria-hidden="true" />
        <span className={`min-w-0 flex-1 text-sm ${open ? "" : "line-clamp-2"} ${rejected ? "line-through" : ""}`}>{claim.text}</span>
        <span className="mt-0.5 shrink-0 text-[0.6rem] tracking-tighter text-muted" title={`${claim.confidence} confidence`} aria-label={`${claim.confidence} confidence`}>
          {DOTS[claim.confidence]}
        </span>
        <Chevron open={open} size="md" />
      </button>
      {open && (
        <ul className="border-t border-line">
          <ClaimCard claim={claim} bare />
        </ul>
      )}
    </li>
  );
}
