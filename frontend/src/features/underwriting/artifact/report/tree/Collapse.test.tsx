import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Collapse } from "./Collapse";

describe("Collapse", () => {
  it("clips its content with a positioned box, so an sr-only input inside cannot grow the panel's scroll height", () => {
    const markup = renderToStaticMarkup(
      <Collapse open={false}>
        <input type="checkbox" className="sr-only" />
      </Collapse>,
    );
    expect(markup).toMatch(/<div class="relative min-h-0 overflow-hidden">/);
    expect(markup).toContain('aria-hidden="true"');
  });
});
