import { describe, expect, it } from "vitest";
import { withCitationLinks } from "./citations";

describe("withCitationLinks", () => {
  it("numbers marks by the order of the ids and drops marks for ids that are not cited", () => {
    const text = "A [[b]] then [[a]] and [[ghost]] again [[b]].";
    expect(withCitationLinks(text, ["b", "a"])).toBe("A [1](claim:b) then [2](claim:a) and again [1](claim:b).");
  });

  it("leaves text without marks alone", () => {
    expect(withCitationLinks("Plain [text](https://example.org).", [])).toBe("Plain [text](https://example.org).");
  });
});
