import { describe, expect, it } from "vitest";
import { MAX_DOCUMENTS, MAX_DOCUMENT_BYTES, formatSize, whyNot } from "./documents";

const file = (name: string, size = 1000) => ({ name, size });

describe("whyNot", () => {
  it("lets a PDF, text or markdown file in, whatever the case of its extension", () => {
    for (const name of ["a.pdf", "b.TXT", "c.md", "My Study (v2).PDF"]) expect(whyNot(file(name), [])).toBeNull();
  });

  it("names the file and the reason when it cannot be added", () => {
    expect(whyNot(file("deck.pptx"), [])).toMatch(/deck\.pptx: only PDF, TXT and MD/);
    expect(whyNot(file("empty.txt", 0), [])).toBe("empty.txt is empty.");
    expect(whyNot(file("big.pdf", MAX_DOCUMENT_BYTES + 1), [])).toBe("big.pdf is over 10 MB.");
    expect(whyNot(file("a.pdf"), [{ name: "a.pdf" }])).toBe("a.pdf is already added.");
  });

  it("stops at the limit of files a run can name", () => {
    const held = Array.from({ length: MAX_DOCUMENTS }, (_, i) => ({ name: `f${i}.txt` }));
    expect(whyNot(file("one-more.txt"), held)).toBe(`At most ${MAX_DOCUMENTS} files can be added.`);
  });
});

describe("formatSize", () => {
  it("is short and reads at a glance", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(48_300)).toBe("48 KB");
    expect(formatSize(2_450_000)).toBe("2.5 MB");
  });
});
