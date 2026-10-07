import type { UnderwritingReport } from "../../../../api/types";

/** Stub nodes write FIXTURE: placeholders. The report is synthetic if it says so or if any text still carries the marker. */
export function isSyntheticReport(report: UnderwritingReport): boolean {
  return report.meta.synthetic || JSON.stringify(report).includes("FIXTURE:");
}
