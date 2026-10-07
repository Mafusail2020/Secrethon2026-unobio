import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Footer } from "./Footer";
import { Home } from "./Home";
import { Navigation } from "./Navigation";

const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const anchorsWithHref = (markup: string) => markup.match(/<a\b[^>]*\shref="[^"]*"/g) ?? [];

describe("the copied unobio.com pages", () => {
  it("have no working links except the home button that opens the chat page", () => {
    const links = anchorsWithHref(html(<Home />));
    expect(links).toHaveLength(1);
    expect(links[0]).toContain('href="/underwriting"');
  });

  it("keep the header and footer inert", () => {
    expect(anchorsWithHref(html(<Navigation dark />))).toEqual([]);
    expect(anchorsWithHref(html(<Footer />))).toEqual([]);
  });

  it("still carry the original copy", () => {
    // the original uses non-breaking spaces in its headlines
    const markup = html(<Home />).replaceAll("\u00a0", " ");
    expect(markup).toContain("AI Native Biopharma");
    expect(markup).toContain("Ten thousand diseases.");
    expect(markup).toContain("Become a");
  });
});
