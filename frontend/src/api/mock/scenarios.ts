import type { Claim, RunEvent, UnderwritingReport } from "../types";

export type Draft = Pick<RunEvent, "type" | "node_id" | "data">;

/** Messy runs for testing the UI without a backend: add ?scenario=<name> when starting a run in mock mode. */
export type Scenario = "sparse" | "large" | "failed" | "slow" | "broken";

const NAMES: Scenario[] = ["sparse", "large", "failed", "slow", "broken"];

export function scenarioFromSearch(search: string): Scenario | undefined {
  const value = new URLSearchParams(search).get("scenario");
  return NAMES.find((n) => n === value);
}

export const stepDelayFactor = (scenario?: Scenario) => (scenario === "slow" ? 12 : 1);

export function adjustDrafts(drafts: Draft[], scenario?: Scenario): Draft[] {
  if (scenario === "failed") {
    const at = drafts.findIndex((d) => d.type === "node.started" && d.node_id === "question_planner");
    if (at < 0) return drafts;
    const error = "FIXTURE: the planner could not parse the program";
    return [
      ...drafts.slice(0, at + 1),
      { type: "node.failed", node_id: "question_planner", data: { error, critical: true } },
      { type: "run.failed", node_id: null, data: { error: `critical step question_planner failed: ${error}` } },
    ];
  }
  if (scenario === "sparse") {
    return drafts.map((d) =>
      d.type === "node.completed" && d.node_id === "fetch_literature"
        ? { type: "node.failed", node_id: d.node_id, data: { error: "FIXTURE: Europe PMC returned 503", critical: false } }
        : d,
    );
  }
  return drafts;
}

const STANCES: Claim["stance"][] = ["pro", "con", "neutral"];
const LABELS: Claim["label"][] = ["extracted", "derived", "inferred", "modeled", "hypothesis", "unknown"];
const CONFIDENCE: Claim["confidence"][] = ["high", "medium", "low"];

export function adjustReport(report: UnderwritingReport, scenario?: Scenario): UnderwritingReport {
  if (scenario === "sparse") {
    report.twin_stats = null;
    report.ledger = null;
    report.valuation = null;
    report.translation_chain = [];
    report.key_risks = [];
    report.diligence_questions = [];
    report.critical_unknowns = ["FIXTURE: public sources were thin for this program"];
    for (const id of ["competition", "commercial_adoption", "capital", "risks"] as const) {
      const section = report.sections[id];
      if (section) {
        section.status = "insufficient_evidence";
        section.key_points = [];
      }
    }
    report.meta = { ...report.meta, failed_nodes: ["fetch_literature"] };
  }
  if (scenario === "broken") {
    // a malformed section: the report panel must contain the crash, not blank the page
    (report.sections.disease_need as unknown as { key_points: null }).key_points = null;
  }
  if (scenario === "large") {
    const evidenceId = Object.keys(report.evidence)[0]!;
    const sections = Object.values(report.sections);
    for (let i = 0; i < 150; i++) {
      const section = sections[i % sections.length]!;
      const label = LABELS[i % LABELS.length]!;
      const needsEvidence = label === "extracted" || label === "derived" || label === "inferred";
      const id = `clm_bulk_${i}`;
      report.claims[id] = {
        id,
        text: `FIXTURE: bulk claim ${i} about ${section.title.toLowerCase()}`,
        section: section.section,
        stance: STANCES[i % STANCES.length]!,
        label,
        evidence_ids: needsEvidence ? [evidenceId] : [],
        confidence: CONFIDENCE[i % CONFIDENCE.length]!,
        produced_by: i % 2 === 0 ? "bull_claim_gate" : "bear_claim_gate",
        status: i % 10 === 0 ? "rejected" : i % 7 === 0 ? "downgraded" : "accepted",
        rejection_reason: i % 10 === 0 ? "FIXTURE: evidence not in this run" : i % 7 === 0 ? "FIXTURE: weak support" : null,
      };
    }
    sections.forEach((section, s) => {
      section.key_points = [
        ...section.key_points,
        { text: "FIXTURE: bulk findings", claim_ids: Array.from({ length: 150 }, (_, i) => `clm_bulk_${i}`).filter((_, i) => i % sections.length === s) },
      ];
    });
  }
  return report;
}
