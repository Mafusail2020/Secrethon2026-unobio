import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { NodeSpec, NodeStatus } from "../../../../api/types";
import { formatDuration } from "../../../../lib/format";
import { STATUS_CLASS, STATUS_ICON, STATUS_TEXT } from "../../status";
import { kindLabel } from "./kindStyle";
import type { PhaseGroup } from "./groups";
import { CHIP_H, GROUP_H, GROUP_W, NODE_H, NODE_W, PANELIST_H, PANELIST_W } from "./layout";

export type SpecData = {
  spec: NodeSpec;
  color: string;
  status: NodeStatus;
  llmCalls: number;
  sources?: number;
  durationMs?: number;
  selected: boolean;
  /** a correction is being drafted: this node is not part of the recompute */
  dim: boolean;
  /** a correction is being drafted: this node would recompute */
  affected: boolean;
  /** a group is unfolding: this step has just appeared and is about to move out to its place */
  entering?: boolean;
  /** a group is folding: this step is on its way into the group box */
  exiting?: boolean;
  /** an analyst of a panel: small, with no detail line */
  compact?: boolean;
  /** what to say first on the detail line instead of the kind, e.g. the step an aggregator stands for */
  subtitle?: string;
} & Record<string, unknown>;

export type GroupData = {
  spec: NodeSpec;
  color: string;
  status: NodeStatus;
  selected: boolean;
  dim: boolean;
  affected: boolean;
  w: number;
  h: number;
  /** where the title chip sits on the top border */
  labelX: number;
  labelW: number;
  /** the chip is centred on the wire that runs through it */
  gate: boolean;
} & Record<string, unknown>;

export type SpecFlowNode = Node<SpecData, "spec">;
// not "group": React Flow styles that built-in type with its own border
export type GroupFlowNode = Node<GroupData, "container">;

export function SpecNodeView({ data }: NodeProps<SpecFlowNode>) {
  const meta = [
    data.subtitle ?? kindLabel(data.spec.kind),
    data.durationMs ? formatDuration(data.durationMs) : undefined,
    data.sources ? `${data.sources} src` : undefined,
    data.llmCalls ? `${data.llmCalls} llm` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="group relative">
      <button
        type="button"
        aria-pressed={data.selected}
        aria-label={`${data.subtitle ? `${data.subtitle} ` : ""}${data.spec.label}, ${data.status}. Open details`}
        style={{ width: data.compact ? PANELIST_W : NODE_W, height: data.compact ? PANELIST_H : NODE_H, borderLeftColor: data.color }}
        className={`flex flex-col items-center justify-center gap-0.5 rounded-md border border-l-4 px-2.5 text-center text-xs shadow-sm transition-[opacity,scale] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${STATUS_CLASS[data.status]} ${
          data.selected ? "outline outline-2 outline-offset-2 outline-brand" : ""
        } ${data.affected ? "ring-2 ring-brand ring-offset-1" : ""} ${data.dim ? "opacity-30" : ""} ${
          data.entering || data.exiting ? "pointer-events-none scale-75 opacity-0" : ""
        }`}
      >
        <Handle type="target" position={Position.Top} className="!opacity-0" />
        <span className="flex max-w-full items-center justify-center gap-1">
          <span className={STATUS_TEXT[data.status]} aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium leading-tight" title={data.spec.label}>{data.spec.label}</span>
          {/* as wide as the status icon, so the name itself sits at the centre of the box */}
          <span className="invisible" aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
        </span>
        {!data.compact && <span className="block max-w-full truncate text-[10.5px] leading-tight text-muted">{meta}</span>}
        <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface p-2 text-xs shadow-lg group-hover:visible"
      >
        <span className="block font-semibold">{data.spec.label}</span>
        <span className="block text-muted">{data.spec.description}</span>
      </div>
    </div>
  );
}

/** The estimated width only places the chip; the chip itself is as wide as its text, so a gate is centred by the browser. */
function chipPlace(d: { labelX: number; labelW: number; gate: boolean }) {
  return d.gate
    ? { left: d.labelX + d.labelW / 2, top: -CHIP_H / 2, height: CHIP_H, transform: "translateX(-50%)" }
    : { left: d.labelX, top: -CHIP_H / 2, height: CHIP_H };
}

export function ContainerNodeView({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      style={{
        width: data.w,
        height: data.h,
        borderColor: `color-mix(in srgb, ${data.color} 50%, transparent)`,
        background: `color-mix(in srgb, ${data.color} 6%, transparent)`,
      }}
      className={`relative rounded-xl border transition-opacity ${data.selected ? "outline outline-2 outline-brand" : ""} ${
        data.affected ? "ring-2 ring-brand" : ""
      } ${data.dim ? "opacity-30" : ""}`}
    >
      <button
        type="button"
        aria-pressed={data.selected}
        aria-label={`${data.spec.label}, ${data.status}. Open details`}
        style={{ ...chipPlace(data), color: data.color, borderColor: `color-mix(in srgb, ${data.color} 50%, transparent)` }}
        className="absolute flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-surface px-2.5 text-[11px] font-semibold leading-none shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className={STATUS_TEXT[data.status]} aria-hidden="true">
          {STATUS_ICON[data.status]}
        </span>
        {data.spec.label}
      </button>
    </div>
  );
}

export type PhaseData = {
  group: PhaseGroup;
  color: string;
  status: NodeStatus;
  done: number;
  total: number;
  /** labels of the steps running inside */
  running: string[];
  dim: boolean;
  affected: boolean;
  entering: boolean;
  exiting: boolean;
} & Record<string, unknown>;

export type PhaseFlowNode = Node<PhaseData, "phase">;

/** A phase folded into one box; a click unfolds it into its steps. */
export function PhaseGroupNodeView({ data }: NodeProps<PhaseFlowNode>) {
  const gone = data.entering || data.exiting;
  return (
    <div className="group relative">
      <button
        type="button"
        aria-expanded={false}
        aria-label={`${data.group.label}, ${data.status}, ${data.done} of ${data.total} steps done. Show the steps`}
        style={{ width: GROUP_W, height: GROUP_H, borderLeftColor: data.color }}
        className={`relative flex cursor-pointer flex-col items-center justify-center rounded-md border border-l-4 px-6 text-center text-xs shadow-[3px_3px_0_-1px_var(--color-line),6px_6px_0_-2px_var(--color-line)] transition-[opacity,scale] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${STATUS_CLASS[data.status]} ${
          data.affected ? "ring-2 ring-brand ring-offset-1" : ""
        } ${data.dim ? "opacity-30" : ""} ${gone ? "pointer-events-none scale-90 opacity-0" : ""}`}
      >
        <Handle type="target" position={Position.Top} className="!opacity-0" />
        <span className="flex max-w-full items-center justify-center gap-1.5">
          <span className={STATUS_TEXT[data.status]} aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
          <span className="min-w-0 truncate text-[0.8rem] font-semibold">{data.group.label}</span>
          <span className="invisible" aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
        </span>
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true">
          ▸
        </span>
        <span className="block max-w-full truncate text-[10px] text-muted">
          {data.done}/{data.total} steps
          {data.running.length ? ` · running ${data.running.join(", ")}` : ""}
        </span>
        <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      </button>
      <div
        role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border border-line bg-surface p-2 text-xs shadow-lg group-hover:visible"
      >
        <span className="block font-semibold">{data.group.label}</span>
        <span className="block text-muted">{data.group.description}</span>
        <span className="mt-1 block text-muted">Click to show its {data.total} steps.</span>
      </div>
    </div>
  );
}

export type OutlineData = {
  group: PhaseGroup;
  color: string;
  status: NodeStatus;
  w: number;
  h: number;
  labelX: number;
  labelW: number;
  gate: boolean;
  dim: boolean;
  affected: boolean;
} & Record<string, unknown>;

export type OutlineFlowNode = Node<OutlineData, "outline">;

/** The frame around an unfolded phase; its title folds the steps back into one box. */
export function OutlineNodeView({ data }: NodeProps<OutlineFlowNode>) {
  return (
    <div
      style={{ width: data.w, height: data.h }}
      className={`uw-fade relative rounded-2xl border border-slate-300 bg-white/30 transition-opacity ${data.affected ? "ring-2 ring-brand/50" : ""} ${data.dim ? "opacity-30" : ""}`}
    >
      <button
        type="button"
        aria-expanded={true}
        aria-label={`${data.group.label}. Fold these steps into one box`}
        data-fold
        style={{ ...chipPlace(data) }}
        className="absolute flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-surface px-2.5 text-[11px] font-semibold leading-none text-slate-600 shadow-sm hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className={STATUS_TEXT[data.status]} aria-hidden="true">
          {STATUS_ICON[data.status]}
        </span>
        {data.group.label}
        <span aria-hidden="true">▾</span>
      </button>
    </div>
  );
}
