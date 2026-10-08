const CITATION = /\s?\[\[([^[\]\s]+)\]\]/g;

/** `[[claim_id]]` marks become numbered links (by the order in `ids`); a mark for an unknown id is dropped. */
export function withCitationLinks(text: string, ids: string[]): string {
  const number = new Map(ids.map((id, i) => [id, i + 1]));
  return text.replace(CITATION, (_, id: string) => (number.has(id) ? ` [${number.get(id)}](claim:${id})` : ""));
}
