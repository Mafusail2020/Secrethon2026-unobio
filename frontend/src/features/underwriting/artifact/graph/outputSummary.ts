export type OutputEntry =
  | { kind: "ids"; key: string; label: string; ids: string[]; more: number }
  | { kind: "count"; key: string; label: string; count: number }
  | { kind: "value"; key: string; value: unknown };

// stable keys from the shared state; everything else is shown as a generic tree
const ID_KEYS: Record<string, string> = { source_ids: "sources", evidence_ids: "evidence items" };
const COUNT_KEYS: Record<string, string> = {
  claims: "claims",
  sections: "sections",
  questions: "questions",
  key_risks: "risks",
  critical_unknowns: "critical unknowns",
  diligence_questions: "diligence questions",
  translation_chain: "translation links",
};

const MORE = /^… (\d+) more$/;

export function splitMore(list: unknown[]): { items: unknown[]; more: number } {
  const last = list.at(-1);
  const match = typeof last === "string" ? MORE.exec(last) : null;
  return match ? { items: list.slice(0, -1), more: Number(match[1]) } : { items: list, more: 0 };
}

/** The server sends a compact view (long lists and dicts are cut and end with "… n more"); this undoes the counting. */
export function summarizeOutput(output: Record<string, unknown>): OutputEntry[] {
  return Object.entries(output).map(([key, value]): OutputEntry => {
    if (key in ID_KEYS && Array.isArray(value)) {
      const { items, more } = splitMore(value);
      return { kind: "ids", key, label: ID_KEYS[key]!, ids: items.filter((i): i is string => typeof i === "string"), more };
    }
    if (key in COUNT_KEYS) {
      if (Array.isArray(value)) {
        const { items, more } = splitMore(value);
        return { kind: "count", key, label: COUNT_KEYS[key]!, count: items.length + more };
      }
      if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        const cut = entries.find(([k]) => k === "…");
        const more = Number(/^(\d+) more$/.exec(String(cut?.[1] ?? ""))?.[1] ?? 0);
        return { kind: "count", key, label: COUNT_KEYS[key]!, count: entries.length - (cut ? 1 : 0) + more };
      }
    }
    return { kind: "value", key, value };
  });
}
