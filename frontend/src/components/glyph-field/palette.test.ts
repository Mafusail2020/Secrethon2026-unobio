import { describe, expect, it } from "vitest";
import { BRAND, DEFAULT_RAMP, FLAME, STOPS, hexToRgb, parseRamp, resamplePalette } from "./palette";

describe("palette", () => {
  it("reads #rrggbb into 0..1 channels and refuses anything else", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(() => hexToRgb("orange")).toThrow();
    expect(() => hexToRgb("#fff")).toThrow();
  });

  it("spreads any palette over the shader's stops and keeps both ends", () => {
    for (const hexes of [FLAME, BRAND, ["#000000", "#ffffff"], ["#000000", "#808080", "#ffffff"]]) {
      const stops = resamplePalette(hexes);
      expect(stops).toHaveLength(STOPS);
      expect(stops[0]).toEqual(hexToRgb(hexes[0]!));
      expect(stops.at(-1)).toEqual(hexToRgb(hexes.at(-1)!));
    }
    expect(resamplePalette(["#000000", "#ffffff"])[2]![0]).toBeCloseTo(0.4);
    expect(() => resamplePalette(["#000000"])).toThrow();
  });

  it("needs two glyphs to draw a difference", () => {
    expect(parseRamp(DEFAULT_RAMP)).toEqual([" ", ".", "B", "S", "/", "M"]);
    expect(() => parseRamp("M")).toThrow();
  });
});
