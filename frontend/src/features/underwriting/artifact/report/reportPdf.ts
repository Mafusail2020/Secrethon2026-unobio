import type { UnderwritingReport } from "../../../../api/types";
import { plain } from "./deck/deckPdf";
import { toMarkdown } from "./markdown";

export interface Block {
  kind: "h1" | "h2" | "quote" | "bullet" | "numbered" | "lead" | "text";
  text: string;
}

const MARGIN = 48;
const LINE = 1.35;
const A4 = { width: 595.28, height: 841.89 };
const STYLE = {
  h1: { size: 18, bold: true, gap: 10, before: 0 },
  h2: { size: 12.5, bold: true, gap: 4, before: 14 },
  quote: { size: 9, bold: true, gap: 6, before: 0 },
  lead: { size: 10, bold: true, gap: 3, before: 6 },
  bullet: { size: 9.5, bold: false, gap: 3, before: 0 },
  numbered: { size: 9.5, bold: false, gap: 3, before: 0 },
  text: { size: 9.5, bold: false, gap: 5, before: 0 },
} as const;

/** What the Markdown export says without its marks: links keep their address in brackets, emphasis is dropped. */
function bare(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:)])/g, "$1$2");
}

/** The Markdown of a report as the blocks a page is made of. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("# ")) out.push({ kind: "h1", text: bare(line.slice(2)) });
    else if (line.startsWith("## ")) out.push({ kind: "h2", text: bare(line.slice(3)) });
    else if (line.startsWith("> ")) out.push({ kind: "quote", text: bare(line.slice(2)) });
    else if (line.startsWith("- ")) out.push({ kind: "bullet", text: bare(line.slice(2)) });
    else if (/^\d+\. /.test(line)) out.push({ kind: "numbered", text: bare(line) });
    else if (/^\*\*[^*]+\*\*$/.test(line)) out.push({ kind: "lead", text: bare(line) });
    else out.push({ kind: "text", text: bare(line) });
  }
  return out;
}

/**
 * The report as a plain A4 PDF made in the browser, from the same text as "Copy as Markdown". It is what the mock offers,
 * which has no backend to build the formatted file; the real one comes from `GET /runs/{id}/report.pdf`.
 */
export async function createReportPdf(report: UnderwritingReport): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const width = A4.width - 2 * MARGIN;
  const measure = (block: Block) => {
    const style = STYLE[block.kind];
    const indent = block.kind === "bullet" ? 12 : 0;
    pdf.setFont("helvetica", style.bold ? "bold" : "normal");
    pdf.setFontSize(style.size);
    const lines: string[] = pdf.splitTextToSize(plain(block.text), width - indent);
    return { block, style, indent, lines };
  };
  const items = blocks(toMarkdown(report)).map(measure);
  let y = MARGIN;
  for (const [i, { block, style, indent, lines }] of items.entries()) {
    const next = items[i + 1];
    // a heading never ends a page: it moves on with the first lines of what follows it; other text may split, but not to one line
    const heading = block.kind === "h2" || block.kind === "lead";
    const keep = heading && next ? style.gap + next.style.before + Math.min(2, next.lines.length) * next.style.size * LINE : 0;
    const least = heading ? lines.length : Math.min(2, lines.length);
    if (y > MARGIN && y + style.before + least * style.size * LINE + keep > A4.height - MARGIN) {
      pdf.addPage();
      y = MARGIN;
    } else y += style.before;
    pdf.setFont("helvetica", style.bold ? "bold" : "normal");
    pdf.setFontSize(style.size);
    pdf.setTextColor(block.kind === "quote" ? "#a16207" : "#0b1020");
    // a block taller than a page carries on over the next one
    for (let rest = lines, first = true; rest.length; first = false) {
      let fit = Math.max(1, Math.floor((A4.height - MARGIN - y) / (style.size * LINE)));
      if (rest.length - fit === 1 && fit > 2) fit -= 1;
      const part = rest.slice(0, fit);
      rest = rest.slice(fit);
      if (block.kind === "bullet" && first) pdf.text("-", MARGIN + 2, y + style.size);
      pdf.text(part, MARGIN + indent, y + style.size, { lineHeightFactor: LINE });
      y += part.length * style.size * LINE;
      if (rest.length) {
        pdf.addPage();
        y = MARGIN;
      }
    }
    y += style.gap;
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#4d5573");
    pdf.text(plain(`Unobio underwriting · ${report.program.mechanism} in ${report.program.indication} · run ${report.run_id}`), MARGIN, A4.height - 24);
    pdf.text(`Page ${page} of ${pages}`, A4.width - MARGIN, A4.height - 24, { align: "right" });
  }
  return pdf.output("blob");
}
