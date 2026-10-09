import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { Claim, UnderwritingReport } from "../../../../../api/types";
import { causeRows, groundedShare, labelMix, sourceMix } from "./chartData";

const report = reportJson as unknown as UnderwritingReport;
const claim = (label: Claim["label"], status: Claim["status"] = "accepted"): Claim => ({
  id: `${label}-${status}`,
  text: "t",
  section: "risks",
  stance: "pro",
  label,
  evidence_ids: [],
  confidence: "high",
  produced_by: "x",
  status,
  rejection_reason: null,
});

describe("causeRows", () => {
  const rows = causeRows(report.ledger!);

  it("keeps the causes that carry risk, in the ledger's order, and says which way the evidence moved each", () => {
    expect(rows.map((r) => r.cause)).toEqual(report.ledger!.by_cause.map((c) => c.cause));
    expect(rows.find((r) => r.cause === "safety")!.change).toBe("up");
    expect(rows.find((r) => r.cause === "commercial")!.change).toBe("same");
    expect(rows.every((r) => r.before > 0)).toBe(true);
  });

  it("leaves out a cause with no hazard at all", () => {
    const ledger = structuredClone(report.ledger!);
    ledger.by_cause[0]!.hazard_prior = { low: 0, base: 0, high: 0, unit: "hazard" };
    ledger.by_cause[0]!.hazard_posterior = { low: 0, base: 0, high: 0, unit: "hazard" };
    expect(causeRows(ledger).map((r) => r.cause)).not.toContain(ledger.by_cause[0]!.cause);
  });
});

describe("labelMix", () => {
  it("counts the claims that count, in label order, and ignores rejected ones", () => {
    const mix = labelMix([claim("extracted"), claim("extracted"), claim("hypothesis"), claim("inferred", "rejected")]);
    expect(mix.map((m) => [m.label, m.count])).toEqual([["extracted", 2], ["hypothesis", 1]]);
    expect(mix.reduce((sum, m) => sum + m.share, 0)).toBeCloseTo(1);
  });

  it("measures how much rests on facts read or computed from a source", () => {
    expect(groundedShare(labelMix([claim("extracted"), claim("derived"), claim("hypothesis"), claim("inferred")]))).toBeCloseTo(0.5);
    expect(groundedShare(labelMix([]))).toBe(0);
  });
});

describe("sourceMix", () => {
  it("counts each cited source once, by kind, most first", () => {
    const mix = sourceMix(report);
    expect(mix.length).toBeGreaterThan(0);
    const values = mix.map((m) => m.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const cited = new Set(
      Object.values(report.claims)
        .filter((c) => c.status !== "rejected")
        .flatMap((c) => c.evidence_ids.map((id) => report.evidence[id]?.source_id))
        .filter(Boolean),
    );
    expect(mix.reduce((sum, m) => sum + m.value, 0)).toBe(cited.size);
  });

  it("is empty when nothing is cited", () => {
    expect(sourceMix({ ...report, claims: {} })).toEqual([]);
  });
});
