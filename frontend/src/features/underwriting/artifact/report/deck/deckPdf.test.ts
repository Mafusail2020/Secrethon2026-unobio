import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drawn = vi.hoisted(() => ({
  toJpeg: vi.fn<(node: HTMLElement, options?: object) => Promise<string>>(async () => "data:image/jpeg;base64,AAAA"),
  pages: [] as string[],
  options: undefined as unknown,
  text: [] as { text: string; x: number; y: number; size: number; options: unknown }[],
  size: 0,
}));

vi.mock("html-to-image", () => ({ toJpeg: drawn.toJpeg }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(options: unknown) {
      drawn.options = options;
    }
    setFont() {}
    setFontSize(size: number) {
      drawn.size = size;
    }
    text(text: string, x: number, y: number, options: unknown) {
      drawn.text.push({ text, x, y, size: drawn.size, options });
    }
    addPage() {
      drawn.pages.push("page");
    }
    addImage() {
      drawn.pages.push("image");
    }
    output() {
      return new Blob(["%PDF"], { type: "application/pdf" });
    }
  },
}));

import { createDeckPdf, plain, saveFile, textRuns } from "./deckPdf";

afterEach(() => {
  drawn.toJpeg.mockClear();
  drawn.pages.length = 0;
  drawn.text.length = 0;
  document.body.replaceChildren();
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

/** A slide whose lines have a made-up place: jsdom does no layout. Each paragraph's data-y is its baseline. */
function slideWith(...lines: { text: string; y: number; size?: number }[]): HTMLElement {
  const slide = document.createElement("section");
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line.text;
    p.dataset.y = String(line.y);
    p.style.fontSize = `${line.size ?? 20}px`;
    slide.append(p);
  }
  document.body.append(slide);
  return slide;
}

beforeEach(() => {
  // jsdom has no Range geometry: each word sits at its offset in the line, on the baseline the paragraph names
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Range) {
      const width = 10 * this.toString().length;
      const left = 100 + this.startOffset * 10;
      const bottom = Number((this.startContainer.parentElement as HTMLElement).dataset.y);
      return { left, right: left + width, top: bottom - 20, bottom, width, height: 20, x: left, y: bottom - 20, toJSON() {} };
    },
  });
});

describe("the deck as a PDF", () => {
  it("draws every slide at full size onto its own landscape page and reports progress", async () => {
    const slides = [document.createElement("section"), document.createElement("section"), document.createElement("section")];
    const progress: [number, number][] = [];
    const file = await createDeckPdf(slides, (done, total) => progress.push([done, total]));
    expect(file.type).toBe("application/pdf");
    expect(drawn.pages).toEqual(["image", "page", "image", "page", "image"]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(drawn.options).toMatchObject({ orientation: "landscape", format: [1280, 720] });
    expect(drawn.toJpeg).toHaveBeenCalledWith(slides[0], expect.objectContaining({ width: 1280, height: 720, style: { transform: "none", margin: "0" } }));
  });

  it("does not paint a background over the slides: the navy title slide would turn white", async () => {
    await createDeckPdf([document.createElement("section")]);
    expect(drawn.toJpeg.mock.calls[0]![1]).not.toHaveProperty("backgroundColor");
  });

  it("hands the file to the browser as a download with the given name", () => {
    URL.createObjectURL = vi.fn(() => "blob:deck");
    URL.revokeObjectURL = vi.fn();
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download} ${this.href}`);
    });
    saveFile(new Blob(["x"]), "deck.pdf");
    expect(clicked).toEqual(["deck.pdf blob:deck"]);
    expect(document.querySelector("a[download]")).toBeNull();
    click.mockRestore();
  });

  it("lays each slide's text over its picture, invisibly, so the file can be searched and copied from", async () => {
    const slide = slideWith({ text: "Probability of success", y: 80, size: 40 }, { text: "range 0.7% to 16%", y: 120, size: 16 });
    await createDeckPdf([slide]);
    expect(drawn.text.map((t) => t.text)).toEqual(["Probability of success", "range 0.7% to 16%"]);
    expect(drawn.text.every((t) => (t.options as { renderingMode: string }).renderingMode === "invisible")).toBe(true);
    expect(drawn.text[0]).toMatchObject({ x: 100, y: 80, size: 30 });
    expect(drawn.text[1]).toMatchObject({ x: 100, y: 120, size: 12 });
  });
});

describe("the text of a slide", () => {
  it("is read as lines with their place, in reading order", () => {
    const runs = textRuns(slideWith({ text: "Our call", y: 70 }, { text: "Do not invest", y: 140 }));
    expect(runs.map((r) => [r.text, r.x, r.y])).toEqual([["Our call", 100, 70], ["Do not invest", 100, 140]]);
  });

  it("joins pieces that sit on one line, which are separate text nodes when the page puts a number in a sentence", () => {
    const slide = slideWith({ text: "Needs ", y: 70 });
    slide.firstElementChild!.append("$12.0M", " over 18 mo");
    expect(textRuns(slide).map((r) => r.text)).toEqual(["Needs $12.0M over 18 mo"]);
  });

  it("skips text that is not drawn", () => {
    const slide = slideWith({ text: "Shown", y: 70 }, { text: "Hidden", y: 140 });
    (slide.lastElementChild as HTMLElement).style.visibility = "hidden";
    expect(textRuns(slide).map((r) => r.text)).toEqual(["Shown"]);
  });

  it("is written in the letters the file's font has: Greek and math signs are spelled out", () => {
    expect(plain("Aβ42 ≥ 60 % (−2 SD) — “ok”…")).toBe('Abeta42 >= 60 % (-2 SD) - "ok"...');
    expect(plain("Zürich ± 5 · 3")).toBe("Zürich ± 5 · 3");
    expect(plain("日本")).toBe("");
  });
});
