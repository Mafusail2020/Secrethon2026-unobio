export type Rgb = [number, number, number];

/** Number of colour stops the shader ramps through. */
export const STOPS = 6;

/** Orange and blue streaks over navy, fading to white: dark to light. */
export const FLAME: string[] = ["#070b24", "#1f3a8a", "#3b63d1", "#ff6a1f", "#ffb98a", "#ffffff"];
/** The product's own blues. */
export const BRAND: string[] = ["#04081a", "#34489f", "#2f55b5", "#7b95e0", "#c9d4f4", "#f6f7fb"];

/**
 * Blue drifting into grey, all of it light: dark text keeps over 12:1 on it and muted text about 4.9:1 on the bluest
 * stop (check before darkening any stop).
 */
export const MIST: string[] = ["#c6d3f1", "#cbd6ee", "#d0d8e9", "#d6dae4", "#dfe2ea", "#e9ecf3"];

/** Glyphs from the lightest area to the darkest. */
export const DEFAULT_RAMP = " .BS/M";

export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Spreads any number of colours (at least two) over exactly STOPS stops, keeping both ends. */
export function resamplePalette(hexes: string[]): Rgb[] {
  if (hexes.length < 2) throw new Error("a palette needs at least two colours");
  const colours = hexes.map(hexToRgb);
  return Array.from({ length: STOPS }, (_, i) => {
    const x = (i / (STOPS - 1)) * (colours.length - 1);
    const lo = Math.min(Math.floor(x), colours.length - 2);
    const f = x - lo;
    const a = colours[lo]!;
    const b = colours[lo + 1]!;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as Rgb;
  });
}

/** The glyphs of a ramp, in order. Two or more are needed to draw any difference. */
export function parseRamp(ramp: string): string[] {
  const glyphs = [...ramp];
  if (glyphs.length < 2) throw new Error("a glyph ramp needs at least two characters");
  return glyphs;
}
