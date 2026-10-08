import type { Range } from "../../../api/types";

const STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1];

export interface PosScale {
  /** the right end of the scale, as a probability */
  max: number;
  /** where a probability sits along the scale, 0 to 100 */
  at: (probability: number) => number;
}

/** A scale from 0 to the next round figure above the highest value shown, so small probabilities still read. */
export function posScale(...ranges: (Range | undefined)[]): PosScale {
  const top = Math.max(0.02, ...ranges.flatMap((r) => (r ? [r.high] : [])));
  const max = STEPS.find((step) => step >= top * 1.1) ?? 1;
  return { max, at: (p) => Math.min(100, Math.max(0, (p / max) * 100)) };
}
