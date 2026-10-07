import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { NodeSpec, NodeStatus } from "../../../../api/types";
import { STATUS_CLASS, STATUS_ICON, STATUS_TEXT } from "../../status";
import { NODE_H, NODE_W } from "./layout";

export type SpecData = {
  spec: NodeSpec;
  color: string;
  status: NodeStatus;
  llmCalls: number;
  selected: boolean;
} & Record<string, unknown>;

export type GroupData = {
  spec: NodeSpec;
  color: string;
  status: NodeStatus;
  selected: boolean;
  w: number;
  h: number;
} & Record<string, unknown>;

export type SpecFlowNode = Node<SpecData, "spec">;
// not "group": React Flow styles that built-in type with its own border
export type GroupFlowNode = Node<GroupData, "container">;

export function SpecNodeView({ data }: NodeProps<SpecFlowNode>) {
  return (
    <div
      style={{ width: NODE_W, height: NODE_H, borderLeftColor: data.color }}
      className={`flex flex-col justify-center rounded-md border border-l-4 px-2 text-xs shadow-sm ${STATUS_CLASS[data.status]} ${
        data.selected ? "outline outline-2 outline-offset-2 outline-brand" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <div className="flex items-center gap-1">
        <span className={STATUS_TEXT[data.status]}>{STATUS_ICON[data.status]}</span>
        <span className="truncate font-medium">{data.spec.label}</span>
      </div>
      <div className="truncate text-[10px] text-muted">
        {data.spec.kind}
        {data.llmCalls ? ` · ${data.llmCalls} llm` : ""}
      </div>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
    </div>
  );
}

export function ContainerNodeView({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      style={{ width: data.w, height: data.h, borderColor: data.color }}
      className={`rounded-lg border-2 border-dashed bg-white/40 ${data.selected ? "outline outline-2 outline-brand" : ""}`}
    >
      <div className="flex items-center gap-1 px-2 pt-1 text-xs font-semibold" style={{ color: data.color }}>
        <span className={STATUS_TEXT[data.status]}>{STATUS_ICON[data.status]}</span>
        {data.spec.label}
      </div>
    </div>
  );
}
