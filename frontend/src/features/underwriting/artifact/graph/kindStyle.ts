import type { GraphSpec, NodeKind } from "../../../../api/types";

export interface KindStyle {
  color: string;
  label: string;
  meaning: string;
}

// colours are ours so the graph can match the UI; an unknown kind falls back to the backend palette
export const KIND_STYLE: Record<NodeKind, KindStyle> = {
  data: { color: "#0284c7", label: "Data source", meaning: "Fetches public records from an official API." },
  processing: { color: "#64748b", label: "Processing", meaning: "Cleans, dedupes or checks material; no judgement." },
  knowledge: { color: "#0d9488", label: "Knowledge", meaning: "Indexes and retrieves the frozen evidence set." },
  quant: { color: "#34489f", label: "Quant", meaning: "Computes probabilities, values and the decision." },
  bull: { color: "#16a34a", label: "Bull case", meaning: "Builds the strongest supported reasons to invest." },
  bear: { color: "#dc2626", label: "Bear case", meaning: "Builds the strongest supported reasons not to invest." },
  analysis: { color: "#d97706", label: "Analysis", meaning: "A model reasons over the evidence." },
  output: { color: "#0f172a", label: "Output", meaning: "Builds the final report." },
};

const FALLBACK = "#64748b";

export function kindColor(kind: NodeKind, spec: GraphSpec): string {
  return KIND_STYLE[kind]?.color ?? spec.kind_colors[kind] ?? FALLBACK;
}

export function kindLabel(kind: string): string {
  return (KIND_STYLE as Record<string, KindStyle | undefined>)[kind]?.label ?? kind;
}

export function kindMeaning(kind: string): string {
  return (KIND_STYLE as Record<string, KindStyle | undefined>)[kind]?.meaning ?? "";
}
