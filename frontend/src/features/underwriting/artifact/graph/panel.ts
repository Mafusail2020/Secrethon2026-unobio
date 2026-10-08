import type { GraphSpec, NodeSpec } from "../../../../api/types";
import { containerIds } from "../../graphUtils";

/** Panelists are drawn steps that do not exist in the pipeline: `<step>~1`, `<step>~2` … */
const SEP = "~";
export const baseId = (id: string) => id.split(SEP)[0]!;
export const isPanelist = (id: string) => id.includes(SEP);

/**
 * What a panel-mode run does, drawn: every step that makes a model call (kind analysis) is answered by `size`
 * analysts in parallel, and the step itself becomes their aggregator, which compares the answers and writes the
 * merged one. The aggregator keeps the step's id, so its status, drawer and corrections stay the step's own.
 */
export function withPanel(spec: GraphSpec, size: number, skip: ReadonlySet<string> = new Set()): GraphSpec {
  const containers = containerIds(spec);
  const expand = new Set(spec.nodes.filter((n) => n.kind === "analysis" && !containers.has(n.id) && !skip.has(n.id)).map((n) => n.id));
  const analysts = (id: string) => Array.from({ length: size }, (_, i) => `${id}${SEP}${i + 1}`);

  const nodes = spec.nodes.flatMap((n): NodeSpec[] => {
    if (!expand.has(n.id)) return [n];
    return [
      ...analysts(n.id).map((id, i) => ({
        ...n,
        id,
        label: `Analyst ${i + 1}`,
        description: `One of ${size} candidate answers for ${n.label}, written in parallel from the same inputs.`,
        correctable: false,
        critical: false,
      })),
      { ...n, label: "Aggregator", description: `Compares the ${size} analysts' answers for ${n.label}, keeps what they agree on and records where they differ. ${n.description}` },
    ];
  });
  const edges = [
    ...spec.edges.flatMap((e) => (expand.has(e.target) ? analysts(e.target).map((target) => ({ ...e, target })) : [e])),
    ...[...expand].flatMap((id) => analysts(id).map((source) => ({ source, target: id }))),
  ];
  return { ...spec, nodes, edges };
}

/** Steps whose panel did not run: the backend said it falls back to a single call. */
export function withoutPanel(logs: Record<string, { message: string }[]>): Set<string> {
  return new Set(Object.entries(logs).flatMap(([id, lines]) => (lines.some((l) => l.message.includes("panel mode is not available")) ? [id] : [])));
}
