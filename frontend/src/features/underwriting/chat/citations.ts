const CITATION = /\s?\[\[([^[\]\s]+)\]\]/g;

/**
 * The ids a text cites, in the order it first cites them. Claims and passages of the user's files share one
 * numbering, so the marks in the text and the list under it agree. Ids that are listed but never marked follow.
 */
export function citationOrder(text: string, claimIds: string[], passageIds: string[] = []): string[] {
  const known = new Set([...claimIds, ...passageIds]);
  const used = [...text.matchAll(CITATION)].map((m) => m[1]!).filter((id) => known.has(id));
  return [...new Set([...used, ...claimIds, ...passageIds])];
}

/** `[[id]]` marks become numbered links (`claim:` or `passage:`, by the order of first use); a mark for an unknown id is dropped. */
export function withCitationLinks(text: string, ids: string[], passageIds: string[] = []): string {
  const number = new Map(citationOrder(text, ids, passageIds).map((id, i) => [id, i + 1]));
  const passages = new Set(passageIds);
  return text.replace(CITATION, (_, id: string) =>
    number.has(id) ? ` [${number.get(id)}](${passages.has(id) ? "passage" : "claim"}:${id})` : "",
  );
}
