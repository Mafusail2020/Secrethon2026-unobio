import { ApiError } from "../api/client";

/** One plain-language message per failure, so no screen shows a raw status or a stack. */
export function friendlyMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "run_not_completed":
        return "This run has not finished yet. Try again once it has completed.";
      case "run_not_found":
        return "That run no longer exists. It may predate a server restart.";
      case "node_not_found":
        return "That step has not run yet.";
      case "node_not_correctable":
        return "That step cannot be corrected directly.";
      case "not_implemented":
        return "That feature is not available yet.";
      case "different_lineage":
        return "Those two runs are not versions of the same analysis.";
      case "validation_error":
        return error.details.length > 0 ? "Some fields need attention." : error.message;
      default:
        return error.message || `The request failed (${error.status}).`;
    }
  }
  if (error instanceof TypeError) return "Cannot reach the backend. Check that it is running.";
  return error instanceof Error ? error.message : String(error);
}
