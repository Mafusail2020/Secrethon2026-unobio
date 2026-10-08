import { afterEach, describe, expect, it, vi } from "vitest";
import { readPref, writePref } from "./storage";

afterEach(() => vi.restoreAllMocks());

describe("storage", () => {
  it("round-trips a value", () => {
    writePref("k", "v");
    expect(readPref("k")).toBe("v");
  });

  it("returns undefined for a missing key", () => {
    expect(readPref("missing")).toBeUndefined();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPref("k")).toBeUndefined();
    expect(() => writePref("k", "v")).not.toThrow();
  });
});
