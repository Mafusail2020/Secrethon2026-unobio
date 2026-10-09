import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { RunSummary, UnderwritingReport } from "../../../../api/types";
import { DocumentsPanel } from "./DocumentsPanel";

const base = reportJson as unknown as UnderwritingReport;
const READ = "doc_00000000000000a1";
const UNREADABLE = "doc_00000000000000b2";

const run = (ids: string[]): RunSummary =>
  ({ id: "r1", status: "completed", program: { indication: "x", mechanism: "y", links: [], document_ids: ids }, options: { effort: "medium" }, created_at: base.meta.created_at, parent_run_id: null, decision: null, error: null }) as unknown as RunSummary;

const withRead = (): UnderwritingReport => {
  const report = structuredClone(base);
  const [id, source] = Object.entries(report.sources)[0]!;
  report.sources[id] = { ...source, type: "user_provided", identifiers: { document: READ, chunks: "23" } };
  return report;
};

const draw = (r: RunSummary, report: UnderwritingReport | undefined) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DocumentsPanel run={r} report={report} canRerun />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("DocumentsPanel", () => {
  it("says for each file whether it was read, could not be read, or is not part of this version", () => {
    const markup = draw(run([READ, UNREADABLE]), withRead());
    expect(markup).toContain("23 passages read");
    expect(markup).toContain("Could not be read, so nothing from it was used");
    expect(markup).toMatch(/cited by \d+ claims?|no claim cites it/);
  });

  it("starts with every file the run read ticked and offers no re-run until something changes", () => {
    const markup = draw(run([READ, UNREADABLE]), withRead());
    expect(markup.match(/type="checkbox"[^>]*checked/g)).toHaveLength(2);
    expect(markup).not.toContain("Re-run with these");
  });

  it("shows only the title and the drop area when the run has no files", () => {
    const markup = draw(run([]), base);
    expect(markup).toContain("Your documents");
    expect(markup).toContain("Drop PDF, text or markdown files here to add them.");
    expect(markup).not.toContain('aria-label="Documents"');
  });

  it("does not claim anything about a file before the run has a report", () => {
    expect(draw(run([READ]), undefined)).toContain("In this run");
  });
});

