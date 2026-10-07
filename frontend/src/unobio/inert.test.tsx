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
  it("keep the home page and footer fully inert", () => {
    expect(anchorsWithHref(html(<Home />))).toEqual([]);
    expect(anchorsWithHref(html(<Footer />))).toEqual([]);
  });

  it("have exactly two working links in the header: the logo (home) and Gravity (the chat page)", () => {
    const links = anchorsWithHref(html(<Navigation dark />));
    expect(links).toHaveLength(2);
    expect(links[0]).toContain('href="/"');
    expect(links[1]).toContain('href="/underwriting"');
  });

  it("still carry the original copy", () => {
    // the original uses non-breaking spaces in its headlines
    const markup = html(<Home />).replaceAll("\u00a0", " ");
    expect(markup).toContain("AI Native Biopharma");
    expect(markup).toContain("Ten thousand diseases.");
    expect(markup).toContain("Become a");
  });
});
