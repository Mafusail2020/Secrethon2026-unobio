import type { NodeStatus } from "../../api/types";

export const STATUS_CLASS: Record<NodeStatus, string> = {
  pending: "border-slate-300 bg-surface text-slate-500",
  running: "border-blue-500 bg-blue-50 ring-2 ring-blue-300 animate-pulse",
  done: "border-emerald-500 bg-surface",
  failed: "border-red-500 bg-red-50",
  skipped: "border-amber-500 bg-amber-50",
  reused: "border-brand/60 border-dashed bg-brand/10",
};

export const STATUS_ICON: Record<NodeStatus, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✕",
  skipped: "⏭",
  reused: "↻",
};

export const STATUS_TEXT: Record<NodeStatus, string> = {
  pending: "text-slate-400",
  running: "text-blue-600",
  done: "text-emerald-600",
  failed: "text-red-600",
  skipped: "text-amber-600",
  reused: "text-brand",
};
