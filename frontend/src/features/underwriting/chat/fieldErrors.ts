import { ApiError } from "../../../api/client";

/** Maps API validation details (`body.program.indication`) to composer field names (`indication`). */
export function fieldErrors(error: unknown): { fields: Record<string, string>; general?: string } {
  if (!(error instanceof ApiError)) {
    return { fields: {}, general: error instanceof Error ? error.message : String(error) };
  }
  const fields: Record<string, string> = {};
  for (const detail of error.details) {
    const parts = detail.path.split(".").filter((p) => p !== "body");
    const name = parts.at(-1);
    if (name) fields[name] = detail.message;
  }
  if (Object.keys(fields).length > 0) return { fields };
  if (/panel size/i.test(error.message)) return { fields: { panel_size: error.message } };
  return { fields: {}, general: error.message };
}
