import { describe, expect, it } from "vitest";
import { BRAND, DEFAULT_RAMP, FLAME, MIST, STOPS, hexToRgb, parseRamp, resamplePalette } from "./palette";

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

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
    expect(parseRamp(DEFAULT_RAMP)).toEqual([" ", ".", "/", "\\", "T", "A", "C", "G"]);
    expect(() => parseRamp("M")).toThrow();
  });

  it("keeps text readable on every stop of the mist, which sits behind the history", () => {
    // with glow strokes the darkest stop is the darkest thing on screen; --color-muted and --color-ink are the text colours
    for (const stop of MIST) {
      expect(contrast(stop, "#4d5573"), `muted text on ${stop}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(stop, "#0b1130"), `ink on ${stop}`).toBeGreaterThanOrEqual(7);
    }
  });
});
