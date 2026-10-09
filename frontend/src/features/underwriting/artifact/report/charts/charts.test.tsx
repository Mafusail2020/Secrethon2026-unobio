import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../../api/types";
import { NumbersCard } from "../tree/NumbersCard";
import { CauseChart } from "./CauseChart";
import { EvidenceMix } from "./EvidenceMix";
import { SourceMix } from "./SourceMix";

const report = reportJson as unknown as UnderwritingReport;
const claims = Object.values(report.claims);

describe("charts", () => {
  it("draw the risk by cause with a legend, from the ledger only", () => {
    const markup = renderToStaticMarkup(<CauseChart ledger={report.ledger!} />);
    for (const word of ["Where the risk comes from", "Safety", "Efficacy", "before the evidence"]) expect(markup).toContain(word);
    expect(markup).toMatch(/aria-label="Safety: riskier after the evidence"/);
  });

  it("show what the claims rest on and name the grounded share", () => {
    const markup = renderToStaticMarkup(<EvidenceMix claims={claims} />);
    expect(markup).toContain("What the claims rest on");
    expect(markup).toMatch(/facts read from a source/);
  });

  it("show the kinds of source cited, and nothing when no claim cites one", () => {
    expect(renderToStaticMarkup(<SourceMix report={report} />)).toContain("Where the evidence comes from");
    expect(renderToStaticMarkup(<SourceMix report={{ ...report, claims: {} }} />)).toBe("");
    expect(renderToStaticMarkup(<EvidenceMix claims={[]} />)).toBe("");
  });
});

describe("the numbers card", () => {
  it("is closed by default and holds every chart once open", () => {
    const closed = renderToStaticMarkup(<NumbersCard report={report} open={false} onToggle={() => {}} />);
    expect(closed).toContain("The numbers behind it");
    expect(closed).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(<NumbersCard report={report} open onToggle={() => {}} />);
    for (const title of ["Where the risk comes from", "What the claims rest on", "Where the evidence comes from"]) expect(open).toContain(title);
  });

  it("says why a block is missing instead of leaving a hole", () => {
    const markup = renderToStaticMarkup(<NumbersCard report={{ ...report, ledger: null, valuation: null, twin_stats: null }} open onToggle={() => {}} />);
    expect(markup).toContain("No evidence ledger was produced");
    expect(markup).toContain("No valuation was produced");
    expect(markup).toContain("Historical twin statistics are not available");
  });
});
