export type StopGroup = "efficacy" | "safety" | "business" | "other";

export const STOP_GROUP_LABEL: Record<StopGroup, string> = {
  efficacy: "Efficacy",
  safety: "Safety",
  business: "Business and operations",
  other: "Other",
};

// the source gives free text, so this is a keyword guess and the UI says so
const RULES: [StopGroup, RegExp][] = [
  ["safety", /safe|adverse|toxic|side.?effect|death|hepat|liver|harm/i],
  ["efficacy", /efficacy|futil|lack of|ineffective|negative|no benefit|endpoint|did not meet|failed to/i],
  ["business", /business|fund|sponsor|commercial|strateg|financ|enrol|recruit|accrual|logistic|administrat|withdrawn|terminated by/i],
];

export function stopGroupOf(reason: string): StopGroup {
  return RULES.find(([, re]) => re.test(reason))?.[0] ?? "other";
}

export interface StopGroupView {
  group: StopGroup;
  total: number;
  items: { reason: string; count: number }[];
}

export function groupStopReasons(reasons: Record<string, number>): StopGroupView[] {
  const groups = new Map<StopGroup, StopGroupView>();
  for (const [reason, count] of Object.entries(reasons)) {
    const group = stopGroupOf(reason);
    const view = groups.get(group) ?? { group, total: 0, items: [] };
    view.total += count;
    view.items.push({ reason, count });
    groups.set(group, view);
  }
  const order: StopGroup[] = ["efficacy", "safety", "business", "other"];
  return order.flatMap((g) => {
    const view = groups.get(g);
    return view ? [{ ...view, items: view.items.sort((a, b) => b.count - a.count) }] : [];
  });
}

function stageRank(stage: string): number {
  const s = stage.toLowerCase();
  if (/preclin/.test(s)) return 0;
  if (/phase\s*(1|i)\b|early/.test(s)) return 1;
  if (/phase\s*(2|ii)\b/.test(s)) return 2;
  if (/phase\s*(3|iii)\b|late/.test(s)) return 3;
  if (/phase\s*(4|iv)\b|approv|market/.test(s)) return 4;
  return 5;
}

/** Furthest stage reached, earliest first; unrecognised stage names keep alphabetical order at the end. */
export function sortStages(distribution: Record<string, number>): { stage: string; count: number }[] {
  return Object.entries(distribution)
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.stage.localeCompare(b.stage));
}
