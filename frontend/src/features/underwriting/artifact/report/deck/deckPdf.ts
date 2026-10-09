import { SLIDE_H, SLIDE_W } from "./SlideFrame";

const PIXEL_RATIO = 1.5;
const QUALITY = 0.8;
// the page is in px, but a font size is always in points
const PT_PER_PX = 0.75;

// jsPDF's built-in fonts hold Latin-1 only; the hidden text layer says these in letters, and drops what it cannot
const SPELLED: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "κ": "kappa", "μ": "mu",
  "≥": ">=", "≤": "<=", "≈": "~", "→": "->", "−": "-", "–": "-", "—": "-", "…": "...",
  "“": '"', "”": '"', "‘": "'", "’": "'",
};

/** What a hidden-layer word is written as: Latin-1 only, so that searching the file finds it. */
export function plain(text: string): string {
  return [...text].map((c) => SPELLED[c] ?? (c.charCodeAt(0) <= 0xff ? c : "")).join("");
}

interface Run {
  text: string;
  /** the left edge of the line and its baseline, in slide pixels */
  x: number;
  y: number;
  size: number;
}

/**
 * The words on a slide as lines, with where each line sits. The slide on screen is scaled by a transform, so
 * what the browser measures is divided back to the slide's own 1280 by 720.
 */
export function textRuns(slide: HTMLElement): Run[] {
  const box = slide.getBoundingClientRect();
  const k = box.width > 0 ? box.width / SLIDE_W : 1;
  const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const runs: Run[] = [];
  let line: Run | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || getComputedStyle(parent).visibility === "hidden") continue;
    const size = parseFloat(getComputedStyle(parent).fontSize) || 12;
    for (const word of (node.textContent ?? "").matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const at = range.getBoundingClientRect();
      const text = plain(word[0]);
      if (at.width === 0 || !text) continue;
      const y = (at.bottom - box.top) / k;
      if (line && Math.abs(line.y - y) < size / 2) line.text += ` ${text}`;
      else runs.push((line = { text, x: (at.left - box.left) / k, y, size }));
    }
  }
  return runs;
}

/**
 * The slides as a landscape PDF, one 16:9 page each, made in the browser from the slides on screen. A slide is
 * drawn by the browser itself, so what is in the file is what the reader sees; it does not use the print dialog.
 * Over each picture goes the slide's text, invisible, so the file can be searched and copied from.
 * The libraries are loaded only when a PDF is asked for.
 */
export async function createDeckPdf(slides: HTMLElement[], onProgress: (done: number, total: number) => void = () => {}): Promise<Blob> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [SLIDE_W, SLIDE_H], compress: true, hotfixes: ["px_scaling"] });
  pdf.setFont("helvetica");
  for (const [i, slide] of slides.entries()) {
    const runs = textRuns(slide);
    // the slide is a fixed 1280 by 720 box that the page scales with a transform on its wrapper; the copy is drawn at full size.
    // No backgroundColor: that would paint over the navy title slide, and every slide paints its own.
    const image = await toJpeg(slide, { quality: QUALITY, pixelRatio: PIXEL_RATIO, width: SLIDE_W, height: SLIDE_H, style: { transform: "none", margin: "0" } });
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], "landscape");
    pdf.addImage(image, "JPEG", 0, 0, SLIDE_W, SLIDE_H, undefined, "FAST");
    for (const run of runs) {
      pdf.setFontSize(run.size * PT_PER_PX);
      pdf.text(run.text, run.x, run.y, { baseline: "bottom", renderingMode: "invisible" });
    }
    onProgress(i + 1, slides.length);
  }
  return pdf.output("blob");
}

/** Hands a file to the browser as a download. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
