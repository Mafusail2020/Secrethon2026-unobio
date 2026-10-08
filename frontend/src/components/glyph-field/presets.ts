import type { GlyphFieldProps } from "./GlyphField";
import { BRAND, FLAME, MIST } from "./palette";

/** Starting points for GlyphField; spread one into the props. */
export const PRESETS = {
  /** the showpiece: full colour, strokes that stand out */
  flame: { palette: FLAME, lattice: 0.7 },
  brand: { palette: BRAND, lattice: 0.7 },
  /** a background to read over: pale blue into grey, strokes lighter than the ground and never darker, slow and shy of the pointer */
  mist: { palette: MIST, strokeContrast: 0.6, glow: true, lattice: 1, speed: 0.45, push: 0.5, backdrop: 1, cell: [7, 11] },
} satisfies Record<string, Partial<GlyphFieldProps>>;
