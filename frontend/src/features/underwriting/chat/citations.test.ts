import { describe, expect, it } from "vitest";
import { citationOrder, withCitationLinks } from "./citations";

describe("withCitationLinks", () => {
  it("numbers marks by the order of the ids and drops marks for ids that are not cited", () => {
    const text = "A [[b]] then [[a]] and [[ghost]] again [[b]].";
    expect(withCitationLinks(text, ["b", "a"])).toBe("A [1](claim:b) then [2](claim:a) and again [1](claim:b).");
  });

  it("leaves text without marks alone", () => {
    expect(withCitationLinks("Plain [text](https://example.org).", [])).toBe("Plain [text](https://example.org).");
  });

  it("numbers claims and passages of the user's files together, by first use, and links each kind its own way", () => {
    const text = "File first [[ev_1]], then a claim [[c1]], the file again [[ev_1]], another file [[ev_2]].";
    expect(withCitationLinks(text, ["c1"], ["ev_1", "ev_2"])).toBe(
      "File first [1](passage:ev_1), then a claim [2](claim:c1), the file again [1](passage:ev_1), another file [3](passage:ev_2).",
    );
  });
});

describe("citationOrder", () => {
  it("is the ids in the order the text first cites them, then any that are listed but not marked", () => {
    const text = "[[ev_2]] [[c2]] [[ghost]] [[c1]] [[ev_2]]";
    expect(citationOrder(text, ["c1", "c2", "c3"], ["ev_1", "ev_2"])).toEqual(["ev_2", "c2", "c1", "c3", "ev_1"]);
  });

  it("matches what the numbers in the text say, so a list under it can follow the same order", () => {
    const text = "[[b]] and [[ev_9]] and [[a]]";
    const order = citationOrder(text, ["a", "b"], ["ev_9"]);
    const numbered = withCitationLinks(text, ["a", "b"], ["ev_9"]);
    order.forEach((id, i) => expect(numbered).toContain(`[${i + 1}](${id.startsWith("ev_") ? "passage" : "claim"}:${id})`));
  });
});
