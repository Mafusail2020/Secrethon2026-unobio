import { describe, expect, it } from "vitest";
import { FIELD_FRAG } from "./shaders";

describe("the rhombus lattice", () => {
  // from the lattice's first line to where it is done being placed
  const lattice = FIELD_FRAG.slice(FIELD_FRAG.indexOf("vec2 lw ="), FIELD_FRAG.indexOf("float g ="));
  const code = lattice.replace(/\/\/.*$/gm, "");

  it("is placed from the screen position alone, so its edges never move", () => {
    expect(lattice.length).toBeGreaterThan(100);
    expect(code).toContain("uv0");
    // no time, no pointer, and not the pushed position: those move the colours behind the panes, not the panes
    expect(code).not.toMatch(/\b(uTime|uPointer|uPush|uv|t)\b/);
  });
});
