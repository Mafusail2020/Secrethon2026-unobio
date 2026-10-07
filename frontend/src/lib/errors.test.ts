import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { friendlyMessage } from "./errors";

describe("friendlyMessage", () => {
  it("explains the known API errors in plain language", () => {
    expect(friendlyMessage(new ApiError(409, "run_not_completed", "x"))).toContain("not finished yet");
    expect(friendlyMessage(new ApiError(404, "run_not_found", "x"))).toContain("no longer exists");
    expect(friendlyMessage(new ApiError(422, "node_not_correctable", "x"))).toContain("cannot be corrected");
    expect(friendlyMessage(new ApiError(501, "not_implemented", "x"))).toContain("not available yet");
  });

  it("points validation errors at the fields and falls back to the server message otherwise", () => {
    expect(friendlyMessage(new ApiError(422, "validation_error", "bad", [{ path: "body.x", message: "m" }]))).toBe("Some fields need attention.");
    expect(friendlyMessage(new ApiError(422, "validation_error", "panel size is capped at 4"))).toBe("panel size is capped at 4");
    expect(friendlyMessage(new ApiError(500, "weird", "boom"))).toBe("boom");
    expect(friendlyMessage(new ApiError(502, "weird", ""))).toBe("The request failed (502).");
  });

  it("recognises a network failure and handles anything else", () => {
    expect(friendlyMessage(new TypeError("Failed to fetch"))).toContain("Cannot reach the backend");
    expect(friendlyMessage(new Error("plain"))).toBe("plain");
    expect(friendlyMessage("text")).toBe("text");
  });
});
