import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { NodeSpec, NodeStatus } from "../../../../api/types";
import { formatDuration } from "../../../../lib/format";
import { STATUS_CLASS, STATUS_ICON, STATUS_TEXT } from "../../status";
import { kindLabel } from "./kindStyle";
import type { PhaseGroup } from "./groups";
import { GROUP_H, GROUP_W, NODE_H, NODE_W } from "./layout";

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
} & Record<string, unknown>;

export type SpecFlowNode = Node<SpecData, "spec">;
// not "group": React Flow styles that built-in type with its own border
export type GroupFlowNode = Node<GroupData, "container">;

export function SpecNodeView({ data }: NodeProps<SpecFlowNode>) {
  const meta = [
    kindLabel(data.spec.kind),
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
        aria-label={`${data.spec.label}, ${data.status}. Open details`}
        style={{ width: NODE_W, height: NODE_H, borderLeftColor: data.color }}
        className={`flex flex-col justify-center rounded-md border border-l-4 px-2 text-left text-xs shadow-sm transition-[opacity,scale] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${STATUS_CLASS[data.status]} ${
          data.selected ? "outline outline-2 outline-offset-2 outline-brand" : ""
        } ${data.affected ? "ring-2 ring-brand ring-offset-1" : ""} ${data.dim ? "opacity-30" : ""} ${
          data.entering || data.exiting ? "pointer-events-none scale-75 opacity-0" : ""
        }`}
      >
        <Handle type="target" position={Position.Top} className="!opacity-0" />
        <span className="flex items-center gap-1">
          <span className={STATUS_TEXT[data.status]} aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
          <span className="truncate font-medium">{data.spec.label}</span>
        </span>
        <span className="block truncate text-[10px] text-muted">{meta}</span>
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

export function ContainerNodeView({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      style={{ width: data.w, height: data.h, borderColor: data.color }}
      className={`rounded-lg border-2 border-dashed bg-surface/40 transition-opacity ${data.selected ? "outline outline-2 outline-brand" : ""} ${
        data.affected ? "ring-2 ring-brand" : ""
      } ${data.dim ? "opacity-30" : ""}`}
    >
      <button
        type="button"
        aria-pressed={data.selected}
        aria-label={`${data.spec.label}, ${data.status}. Open details`}
        className="flex items-center gap-1 rounded px-2 pt-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        style={{ color: data.color }}
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
        className={`flex cursor-pointer flex-col justify-center rounded-md border border-l-4 px-2.5 text-left text-xs shadow-[3px_3px_0_-1px_var(--color-line),6px_6px_0_-2px_var(--color-line)] transition-[opacity,scale] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${STATUS_CLASS[data.status]} ${
          data.affected ? "ring-2 ring-brand ring-offset-1" : ""
        } ${data.dim ? "opacity-30" : ""} ${gone ? "pointer-events-none scale-90 opacity-0" : ""}`}
      >
        <Handle type="target" position={Position.Top} className="!opacity-0" />
        <span className="flex items-center gap-1.5">
          <span className={STATUS_TEXT[data.status]} aria-hidden="true">
            {STATUS_ICON[data.status]}
          </span>
          <span className="truncate text-[0.8rem] font-semibold">{data.group.label}</span>
          <span className="ml-auto text-muted" aria-hidden="true">
            ▸
          </span>
        </span>
        <span className="block truncate text-[10px] text-muted">
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
  dim: boolean;
  affected: boolean;
} & Record<string, unknown>;

export type OutlineFlowNode = Node<OutlineData, "outline">;

/** The frame around an unfolded phase; its title folds the steps back into one box. */
export function OutlineNodeView({ data }: NodeProps<OutlineFlowNode>) {
  return (
    <div
      style={{ width: data.w, height: data.h }}
      className={`uw-fade rounded-lg border border-line transition-opacity ${data.affected ? "ring-2 ring-brand/50" : ""} ${data.dim ? "opacity-30" : ""}`}
    >
      <button
        type="button"
        aria-expanded={true}
        aria-label={`${data.group.label}. Fold these steps into one box`}
        data-fold
        className="flex items-center gap-1 rounded px-2 pt-1 text-[11px] font-semibold text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
