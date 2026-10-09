import { afterEach, describe, expect, it, vi } from "vitest";

const drawn = vi.hoisted(() => ({ toJpeg: vi.fn<(node: HTMLElement, options?: object) => Promise<string>>(async () => "data:image/jpeg;base64,AAAA"), pages: [] as string[], options: undefined as unknown }));

vi.mock("html-to-image", () => ({ toJpeg: drawn.toJpeg }));
vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(options: unknown) {
      drawn.options = options;
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

import { createDeckPdf, saveFile } from "./deckPdf";

afterEach(() => {
  drawn.toJpeg.mockClear();
  drawn.pages.length = 0;
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
});
