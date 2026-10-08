import { describe, expect, it } from "vitest";
import { posScale } from "./posScale";

const range = (low: number, base: number, high: number) => ({ low, base, high, unit: "probability" });

describe("posScale", () => {
  it("stops at the next round figure above the highest value, so a small probability still reads", () => {
    expect(posScale(range(0.007, 0.04, 0.16)).max).toBe(0.2);
    expect(posScale(range(0.01, 0.02, 0.03)).max).toBe(0.05);
    expect(posScale(range(0.3, 0.5, 0.9)).max).toBe(1);
  });

  it("takes the prior into account and ignores one that is missing", () => {
    expect(posScale(range(0.01, 0.04, 0.06), range(0.1, 0.2, 0.28)).max).toBe(0.4);
    expect(posScale(range(0.01, 0.04, 0.06), undefined).max).toBe(0.1);
  });

  it("places values along the scale and keeps them inside it", () => {
    const scale = posScale(range(0.007, 0.04, 0.16));
    expect(scale.at(0.1)).toBeCloseTo(50);
    expect(scale.at(0)).toBe(0);
    expect(scale.at(5)).toBe(100);
    expect(scale.at(-1)).toBe(0);
  });
});
