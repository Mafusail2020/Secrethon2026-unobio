import { SLIDE_H, SLIDE_W } from "./SlideFrame";

const PIXEL_RATIO = 2;
const QUALITY = 0.92;

/**
 * The slides as a landscape PDF, one 16:9 page each, made in the browser from the slides on screen. A slide is
 * drawn by the browser itself, so what is in the file is what the reader sees; it does not use the print dialog.
 * The libraries are loaded only when a PDF is asked for.
 */
export async function createDeckPdf(slides: HTMLElement[], onProgress: (done: number, total: number) => void = () => {}): Promise<Blob> {
  const [{ toJpeg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [SLIDE_W, SLIDE_H], compress: true, hotfixes: ["px_scaling"] });
  for (const [i, slide] of slides.entries()) {
    // the slide is a fixed 1280 by 720 box that the page scales with a transform on its wrapper; the copy is drawn at full size.
    // No backgroundColor: that would paint over the navy title slide, and every slide paints its own.
    const image = await toJpeg(slide, { quality: QUALITY, pixelRatio: PIXEL_RATIO, width: SLIDE_W, height: SLIDE_H, style: { transform: "none", margin: "0" } });
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], "landscape");
    pdf.addImage(image, "JPEG", 0, 0, SLIDE_W, SLIDE_H, undefined, "FAST");
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
