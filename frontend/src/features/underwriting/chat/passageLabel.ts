import type { EvidenceDetail } from "../../../api/types";

const PREFIX = "User document: ";

/** "BACE1 mouse study.pdf" and " · p. 3": the file and the page a passage comes from. */
export function passageLabel(detail: EvidenceDetail): { name: string; where: string } {
  return {
    name: detail.source.title.replace(PREFIX, ""),
    where: detail.evidence.locator ? ` · ${detail.evidence.locator}` : "",
  };
}

/** The PDF page a locator like "p. 3", "p. 3 [2]" or "p. 3 (OCR)" names; text files have none. */
export function pageOf(locator: string | null | undefined): number | undefined {
  const match = /^p\. (\d+)/.exec(locator ?? "");
  return match ? Number(match[1]) : undefined;
}
