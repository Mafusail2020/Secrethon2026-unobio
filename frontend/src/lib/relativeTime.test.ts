import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const now = new Date("2026-10-07T12:00:00Z").getTime();

describe("relativeTime", () => {
  it.each([
    ["2026-10-07T11:59:30Z", "30 seconds ago"],
    ["2026-10-07T11:50:00Z", "10 minutes ago"],
    ["2026-10-07T09:00:00Z", "3 hours ago"],
    ["2026-10-06T12:00:00Z", "yesterday"],
    ["2026-10-02T12:00:00Z", "5 days ago"],
  ])("%s -> %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});
