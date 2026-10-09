import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../api/types";
import { AnalysisSources } from "./AnalysisSources";
import { analysisSources, summarizeSources } from "./sourcesView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = reportJson as unknown as UnderwritingReport;

const withUpload = (): UnderwritingReport => {
  const report = structuredClone(base);
  report.sources["src_upload"] = {
    id: "src_upload",
    type: "user_provided",
    title: "User document: study.pdf",
    url: null,
    publisher: "You",
    published_at: null,
    retrieved_at: base.meta.created_at,
    identifiers: { document: "doc_0123456789abcdef" },
  };
  return report;
};

describe("analysisSources", () => {
  it("leaves out the files the user uploaded, which have their own list, and keeps everything else", () => {
    const report = withUpload();
    const found = analysisSources(report);
    expect(found.sources["src_upload"]).toBeUndefined();
    expect(Object.keys(found.sources)).toEqual(Object.keys(base.sources));
    expect(report.sources["src_upload"]).toBeDefined();
  });
});

describe("summarizeSources", () => {
  it("counts the sources and names the publishers, the most frequent first", () => {
    const { count, publishers } = summarizeSources(base);
    expect(count).toBe(Object.keys(base.sources).length);
    const tally = new Map<string, number>();
    for (const s of Object.values(base.sources)) tally.set(s.publisher, (tally.get(s.publisher) ?? 0) + 1);
    expect(tally.get(publishers[0]!)).toBe(Math.max(...tally.values()));
    expect(new Set(publishers).size).toBe(publishers.length);
  });
});

describe("AnalysisSources", () => {
  it("is closed to start with, says how many sources there are and who from, and does not count the uploaded file", () => {
    const markup = renderToStaticMarkup(<AnalysisSources report={withUpload()} onOpenClaim={() => {}} />);
    expect(markup).toContain("Found by the analysis");
    expect(markup).toContain("Public sources");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-open="false"');
    expect(markup).toContain(`${Object.keys(base.sources).length} sources`);
    expect(markup).not.toContain("study.pdf");
  });

  it("opens and closes on its button", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<AnalysisSources report={base} onOpenClaim={() => {}} />));
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("Show");
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).toContain("Hide");
    expect(host.querySelector('[data-open="true"]')).not.toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector('[data-open="true"]')).toBeNull();
    act(() => root.unmount());
  });

  it("has nothing to open when the analysis found no public sources", () => {
    const markup = renderToStaticMarkup(<AnalysisSources report={{ ...base, sources: {}, evidence: {}, claims: {} }} onOpenClaim={() => {}} />);
    expect(markup).toContain("The analysis found no public sources.");
    expect(markup).toContain("disabled");
  });
});
