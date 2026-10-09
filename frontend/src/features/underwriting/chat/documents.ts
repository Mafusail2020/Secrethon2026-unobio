import type { DocumentInfo } from "../../../api/types";

export const MAX_DOCUMENTS = 5;
export const MAX_DOCUMENT_BYTES = 10_000_000;
export const DOCUMENT_ACCEPT = ".pdf,.txt,.md";

const ALLOWED = /\.(pdf|txt|md)$/i;

export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** Why a file cannot be added, or null when it can. The server checks again; this saves the round trip. */
export function whyNot(file: Pick<File, "name" | "size">, held: Pick<DocumentInfo, "name">[]): string | null {
  if (!ALLOWED.test(file.name)) return `${file.name}: only PDF, TXT and MD files can be added.`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_DOCUMENT_BYTES) return `${file.name} is over ${MAX_DOCUMENT_BYTES / 1_000_000} MB.`;
  if (held.some((d) => d.name === file.name)) return `${file.name} is already added.`;
  if (held.length >= MAX_DOCUMENTS) return `At most ${MAX_DOCUMENTS} files can be added.`;
  return null;
}
