import type { Claim } from "../../../../api/types";

export type ClaimLabel = Claim["label"];

/** What each claim label promises. Shown as tooltips so a non-biologist can tell fact from inference. */
export const LABEL_HELP: Record<ClaimLabel, { title: string; body: string }> = {
  extracted: { title: "Extracted", body: "Read directly from a source record or quote. The evidence shows the exact text." },
  derived: { title: "Derived", body: "Computed from extracted facts by a stated rule, for example a count or a date difference." },
  inferred: { title: "Inferred", body: "Reasoned from the cited evidence. The evidence supports it but does not state it." },
  modeled: { title: "Modeled", body: "An estimate from a model or labelled assumptions, shown as a range, not a fact." },
  hypothesis: { title: "Hypothesis", body: "The model's own background knowledge. No evidence is cited, so treat it as a lead to check." },
  unknown: { title: "Unknown", body: "Public evidence could not answer this. We say so instead of guessing." },
};

export const LABEL_ORDER: ClaimLabel[] = ["extracted", "derived", "inferred", "modeled", "hypothesis", "unknown"];
