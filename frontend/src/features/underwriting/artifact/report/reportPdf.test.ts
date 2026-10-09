import { afterEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../api/types";

const made = vi.hoisted(() => ({
  text: [] as { text: string | string[]; page: number }[],
  pages: 1,
  current: 1,
  lineChars: 90,
}));

vi.mock("jspdf", () => ({
  jsPDF: class {
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    splitTextToSize(text: string) {
      return text.match(new RegExp(`.{1,${made.lineChars}}(\\s|$)`, "g"))?.map((l) => l.trim()) ?? [text];
    }
    text(text: string | string[]) {
      made.text.push({ text, page: made.current });
    }
    addPage() {
      made.current = ++made.pages;
    }
    getNumberOfPages() {
      return made.pages;
    }
    setPage(page: number) {
      made.current = page;
    }
    output() {
      return new Blob(["%PDF"], { type: "application/pdf" });
    }
  },
}));

import { toMarkdown } from "./markdown";
import { blocks, createReportPdf } from "./reportPdf";

const report = reportJson as unknown as UnderwritingReport;
const all = () => made.text.flatMap((t) => (Array.isArray(t.text) ? t.text : [t.text]));

afterEach(() => {
  made.text.length = 0;
  made.pages = 1;
  made.current = 1;
  made.lineChars = 90;
});

describe("the blocks of a report", () => {
  it("are read from the Markdown, without its marks and with link addresses kept", () => {
    const parsed = blocks(
      ["# BACE1 in AD", "", "> Synthetic data: placeholder", "**Verdict: Conditional** (low) · 3.9%", "## Reasons", "- ▲ biological link", "**A lead line**", "1. First question — why", "A [trial](https://x.test/1) said _so_ and **more**."].join("\n"),
    );
    expect(parsed).toEqual([
      { kind: "h1", text: "BACE1 in AD" },
      { kind: "quote", text: "Synthetic data: placeholder" },
      { kind: "text", text: "Verdict: Conditional (low) · 3.9%" },
      { kind: "h2", text: "Reasons" },
      { kind: "bullet", text: "▲ biological link" },
      { kind: "lead", text: "A lead line" },
      { kind: "numbered", text: "1. First question — why" },
      { kind: "text", text: "A trial (https://x.test/1) said so and more." },
    ]);
  });
});

describe("the report as a plain PDF", () => {
  it("holds the title, the verdict, every claim and its sources, as one file", async () => {
    const file = await createReportPdf(report);
    expect(file.type).toBe("application/pdf");
    const text = all().join("\n");
    expect(text).toContain("BACE1 inhibition in Alzheimer's disease");
    expect(text).toContain("Verdict: Conditional");
    expect(text).toContain("(for) FIXTURE: biological link supports the thesis");
    expect(text).toContain("https://clinicaltrials.gov/study/NCT01739348");
    for (const claim of Object.values(report.claims)) expect(text).toContain(claim.text.slice(0, 40));
  });

  it("starts new pages when one is full, and numbers every page and names the run on it", async () => {
    made.lineChars = 30;
    await createReportPdf(report);
    expect(made.pages).toBeGreaterThan(2);
    const footers = made.text.filter((t) => typeof t.text === "string" && /^Page \d+ of \d+$/.test(t.text));
    expect(footers.map((f) => f.text)).toEqual(Array.from({ length: made.pages }, (_, i) => `Page ${i + 1} of ${made.pages}`));
    expect(footers.map((f) => f.page)).toEqual(Array.from({ length: made.pages }, (_, i) => i + 1));
    expect(made.text.filter((t) => typeof t.text === "string" && t.text.includes(`run ${report.run_id}`))).toHaveLength(made.pages);
  });

  it("never leaves a heading alone at the foot of a page, whatever the width of the lines", async () => {
    const headings = new Set(blocks(toMarkdown(report)).filter((b) => b.kind === "h2" || b.kind === "lead").map((b) => b.text));
    for (let chars = 24; chars <= 110; chars += 2) {
      made.text.length = 0;
      made.pages = made.current = 1;
      made.lineChars = chars;
      await createReportPdf(report);
      const body = made.text.filter((t) => !(typeof t.text === "string" && /^(Page \d|Unobio underwriting)/.test(t.text)));
      for (let page = 1; page < made.pages; page++) {
        const last = body.filter((t) => t.page === page).at(-1);
        const lines = last && (Array.isArray(last.text) ? last.text : [last.text]);
        expect(lines && headings.has(lines.at(-1)!), `a heading ends page ${page} at ${chars} characters a line`).toBe(false);
      }
    }
  });

  it("carries a paragraph longer than a page over onto the next, and loses none of it", async () => {
    made.lineChars = 20;
    const long = { ...report, verdict: { ...report.verdict, rationale: Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ") } };
    await createReportPdf(long);
    const text = all().join(" ");
    expect(text).toContain("w0 ");
    expect(text).toContain("w399");
    expect(made.pages).toBeGreaterThan(3);
  });
});
