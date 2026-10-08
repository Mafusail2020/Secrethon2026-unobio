import type { GraphSpec, NodeStatus } from "../../../../api/types";
import { STATUS_ICON, STATUS_TEXT } from "../../status";
import { KIND_STYLE, kindColor, kindLabel, kindMeaning } from "./kindStyle";
import { WIRE_COLOR, type WireState } from "./wires";

const STATUSES: [NodeStatus, string][] = [
  ["pending", "waiting"],
  ["running", "running"],
  ["done", "done"],
  ["failed", "failed"],
  ["skipped", "skipped (budget)"],
  ["reused", "reused from the previous run"],
];

const WIRES: [WireState, string, string | undefined][] = [
  ["pending", "waiting for the step before", undefined],
  ["done", "carried: the step before finished", undefined],
  ["active", "in flight: the step after is running", "7 6"],
  ["reused", "reused from the previous run", "3 4"],
  ["failed", "a step on it failed", undefined],
];

export function GraphLegend({ spec }: { spec: GraphSpec }) {
  const kinds = [...new Set(spec.nodes.map((n) => n.kind))].filter((k) => k in KIND_STYLE || k in spec.kind_colors);
  return (
    <details className="rounded-lg border border-line bg-surface/95 text-xs shadow-sm">
      <summary className="cursor-pointer px-2 py-1 font-medium">Legend</summary>
      <div className="max-w-64 space-y-2 border-t border-line p-2">
        <ul className="space-y-1">
          {kinds.map((kind) => (
            <li key={kind} className="flex items-start gap-1.5">
              <span className="mt-0.5 h-3 w-1 shrink-0 rounded-sm" style={{ background: kindColor(kind, spec) }} aria-hidden="true" />
              <span>
                <span className="font-medium">{kindLabel(kind)}</span>
                <span className="block text-muted">{kindMeaning(kind)}</span>
              </span>
            </li>
          ))}
        </ul>
        <ul className="grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-line pt-2">
          {STATUSES.map(([status, label]) => (
            <li key={status} className="flex items-center gap-1">
              <span className={STATUS_TEXT[status]} aria-hidden="true">
                {STATUS_ICON[status]}
              </span>
              {label}
            </li>
          ))}
        </ul>
        <ul className="space-y-1 border-t border-line pt-2" aria-label="Wires">
          {WIRES.map(([state, label, dash]) => (
            <li key={state} className="flex items-center gap-2">
              <svg width="28" height="8" aria-hidden="true" className="shrink-0">
                <line x1="1" y1="4" x2="27" y2="4" stroke={WIRE_COLOR[state]} strokeWidth="2" strokeDasharray={dash} strokeLinecap="round" />
              </svg>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
