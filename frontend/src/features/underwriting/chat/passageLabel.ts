import type { EvidenceDetail } from "../../../api/types";

const PREFIX = "User document: ";

/** "BACE1 mouse study.pdf" and " · p. 3": the file and the page a passage comes from. */
export function passageLabel(detail: EvidenceDetail): { name: string; where: string } {
  return {
    name: detail.source.title.replace(PREFIX, ""),
    where: detail.evidence.locator ? ` · ${detail.evidence.locator}` : "",
  };
}
