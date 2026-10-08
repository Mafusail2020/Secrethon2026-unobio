import type { Decision, Range } from "../api/types";

export const pct = (value: number) =>
  `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;

export const pctRange = (r: Range) => `${pct(r.base)} (${pct(r.low)} to ${pct(r.high)})`;

export function usd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export const usdRange = (r: Range) => `${usd(r.base)} (${usd(r.low)} to ${usd(r.high)})`;

export const months = (r: Range) => `${r.base.toFixed(0)} mo (${r.low.toFixed(0)} to ${r.high.toFixed(0)})`;

export const DECISION_LABEL: Record<Decision, string> = {
  invest: "Invest",
  conditional: "Conditional",
  do_not_invest: "Do not invest",
};

export const DECISION_STYLE: Record<Decision, string> = {
  invest: "bg-emerald-100 text-emerald-800 border-emerald-300",
  conditional: "bg-amber-100 text-amber-800 border-amber-300",
  do_not_invest: "bg-red-100 text-red-800 border-red-300",
};

export const humanize = (id: string) => id.replace(/_/g, " ");

export function relativeMs(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return `+${(ms / 1000).toFixed(1)}s`;
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** null means the price is unknown; a cost is never guessed. */
export function formatCost(usd: number | null): string {
  return usd === null ? "price unknown" : `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
}

export function priceLabel(inPerMtok?: number | null, outPerMtok?: number | null): string {
  if (inPerMtok == null || outPerMtok == null) return "price unknown";
  return `$${inPerMtok} in / $${outPerMtok} out per 1M tokens`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
