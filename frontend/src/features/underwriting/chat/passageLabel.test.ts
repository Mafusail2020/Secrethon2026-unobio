import { describe, expect, it } from "vitest";
import { pageOf } from "./passageLabel";

describe("pageOf", () => {
  it("reads the page of a PDF locator, however it is decorated", () => {
    expect(pageOf("p. 3")).toBe(3);
    expect(pageOf("p. 3 [2]")).toBe(3);
    expect(pageOf("p. 12 (OCR)")).toBe(12);
  });

  it("has no page for text files or for nothing", () => {
    expect(pageOf("part 2")).toBeUndefined();
    expect(pageOf("page text (truncated)")).toBeUndefined();
    expect(pageOf(null)).toBeUndefined();
    expect(pageOf(undefined)).toBeUndefined();
  });
});
