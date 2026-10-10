import { describe, expect, it } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../../api/types";
import { buildNote, slug } from "./noteDoc";

const fixture = reportJson as unknown as UnderwritingReport;
const clean = JSON.parse(JSON.stringify(fixture).replaceAll("FIXTURE:", "Real:")) as UnderwritingReport;
clean.meta = { ...clean.meta, synthetic: false };

describe("the report as a note", () => {
  const note = buildNote(clean);
  const lines = note.markdown.split("\n");

  it("starts with the title and has a second-level heading for the verdict, each question, the numbers and the risks", () => {
    expect(lines[0]).toBe("# BACE1 inhibition in Alzheimer's disease");
    const h2 = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    expect(h2).toEqual(expect.arrayContaining(["Verdict", "Will it work in people?", "Will it get through trials and regulators?", "Will it actually be used?", "Is funding it to the next milestone worth it?", "The numbers behind it", "Risks and what we do not know"]));
    expect(note.outline.map((o) => o.text)).toEqual([...h2, "Sources"]);
    expect(note.outline[0]).toEqual({ id: "verdict", text: "Verdict" });
    expect(slug("Will it work in people?")).toBe("will-it-work-in-people");
  });

  it("keeps heading levels apart: for and against under a question, the sections under their own heading", () => {
    expect(lines).toEqual(expect.arrayContaining(["### For", "### Against", "### What the sections say", "#### Scientific thesis (ok)"]));
    expect(lines.indexOf("### What carries it")).toBeGreaterThan(lines.indexOf("## Verdict"));
  });

  it("cites sources by number in order of first use, and every cited number is in the list", () => {
    const cited = [...note.markdown.matchAll(/\]\(#src-(\d+)\)/g)].map((m) => Number(m[1]));
    expect(cited.length).toBeGreaterThan(0);
    expect(note.sources.map((s) => s.n)).toEqual(note.sources.map((_, i) => i + 1));
    expect(new Set(cited)).toEqual(new Set(note.sources.map((s) => s.n)));
    // numbers are handed out as the text first cites them
    const firstUse = [...new Set(cited)];
    expect(firstUse).toEqual([...firstUse].sort((a, b) => a - b));
    expect(note.sources[0]!.url).toMatch(/^https:\/\//);
  });

  it("puts the verbatim quote under the claim and shows a rejected claim with the gate's reason", () => {
    expect(note.markdown).toMatch(/\n {2}> “/);
    const rejected = Object.values(clean.claims).find((c) => c.status === "rejected")!;
    expect(note.markdown).toContain(`Rejected by the evidence gate: ${rejected.rejection_reason}`);
    expect(note.markdown).toContain("### Rejected by the evidence gate");
  });

  it("writes percentages with one decimal, so the figures agree with the sentences the model wrote", () => {
    expect(note.markdown).toMatch(/probability of success \*\*\d+\.\d%/);
    expect(note.properties.find((p) => p.key === "probability of success")!.value).toMatch(/^\d+\.\d% \(\d+\.\d% to \d+\.\d%\)$/);
  });

  it("has the numbers behind it as tables and lists: the ledger steps, the similar programs, the funding", () => {
    expect(lines).toEqual(expect.arrayContaining(["| Evidence | Cause | Effect |", "| Drug | Disease | Stage | Status |", "### Funding to the next milestone"]));
  });

  it("keeps the properties and tags an Obsidian note would", () => {
    expect(note.properties.map((p) => p.key)).toEqual(expect.arrayContaining(["decision", "probability of success", "run", "created", "model"]));
    expect(note.properties.find((p) => p.key === "run")!.value).toBe(clean.run_id);
    expect(note.tags).toEqual(["#conditional", "#alzheimer-s-disease", "#bace1-inhibition"]);
  });

  it("marks placeholder content as synthetic, and only that", () => {
    expect(note.synthetic).toBe(false);
    expect(buildNote(fixture).synthetic).toBe(true);
  });
});

describe("a note from awkward reports", () => {
  it("escapes what Markdown would read as marks, so a claim cannot turn into a heading or a link", () => {
    const [id, claim] = Object.entries(clean.claims)[0]!;
    const evil = { ...clean, claims: { ...clean.claims, [id]: { ...claim, text: "# not a heading *bold* [link](http://x.test) _under_ | pipe" } } };
    const text = buildNote(evil).markdown;
    expect(text).toContain("\\# not a heading \\*bold\\* \\[link\\](http://x.test) \\_under\\_ \\| pipe");
    expect(text).not.toMatch(/^# not a heading/m);
  });

  it("builds from a report with no ledger, twins, valuation or claims", () => {
    const thin = { ...clean, ledger: null, twin_stats: null, valuation: null, assessments: [], claims: {}, sources: {}, evidence: {} } as unknown as UnderwritingReport;
    const note = buildNote(thin);
    expect(note.markdown).toContain("## Verdict");
    expect(note.markdown).toContain("*No claim either way.*");
    expect(note.sources).toEqual([]);
    expect(note.outline.at(-1)!.text).not.toBe("Sources");
    expect(note.markdown).not.toContain("](#src-");
  });
});
