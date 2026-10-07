import { describe, expect, it } from "vitest";
import { ApiError } from "../../../api/client";
import { fieldErrors } from "./fieldErrors";

describe("fieldErrors", () => {
  it("maps API detail paths to composer field names", () => {
    const error = new ApiError(422, "validation_error", "request validation failed", [
      { path: "body.program.indication", message: "Field required" },
      { path: "body.options.panel_size", message: "Input should be >= 2" },
    ]);
    expect(fieldErrors(error)).toEqual({
      fields: { indication: "Field required", panel_size: "Input should be >= 2" },
    });
  });

  it("attaches the panel size cap message to the panel field", () => {
    const error = new ApiError(422, "validation_error", "panel size is capped at 4");
    expect(fieldErrors(error).fields).toEqual({ panel_size: "panel size is capped at 4" });
  });

  it("keeps other errors as a general message", () => {
    expect(fieldErrors(new ApiError(500, "internal_error", "boom"))).toEqual({ fields: {}, general: "boom" });
    expect(fieldErrors(new Error("offline")).general).toBe("offline");
  });
});
