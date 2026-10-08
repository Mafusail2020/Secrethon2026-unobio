import { useState, type ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge";
import { ChevronDownIcon } from "../../../components/ui/icons";
import { Spinner } from "../../../components/ui/Spinner";
import type { RunStream } from "../reduceEvents";

/**
 * The run's working, folded away. Closed, it is one line: the step being worked on while the run goes, a short
 * result afterwards. The step list sits inside it (kept mounted, so each step keeps its own open state).
 */
export function WorkTrace({
  status,
  text,
  progress,
  stubData,
  children,
}: {
  status: RunStream["status"];
  text: string;
  progress?: string;
  stubData: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const going = status === "running" || status === "queued";
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="work-trace"
        className="group flex w-full items-center gap-2 rounded-lg py-1 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {going && <Spinner />}
        {status === "completed" && <span className="text-emerald-600" aria-hidden="true">✓</span>}
        {status === "failed" && <span className="text-red-600" aria-hidden="true">✕</span>}
        <span role="status" className={`min-w-0 truncate ${going ? "font-medium" : "text-muted"}`}>
          {text}
        </span>
        {progress && <span className="shrink-0 text-xs text-muted">{progress}</span>}
        {stubData && <Badge className="border-amber-300 bg-amber-50 text-amber-800">stub data</Badge>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted group-hover:text-ink">
          {open ? "Hide steps" : "Show steps"}
          <ChevronDownIcon width={14} height={14} className={open ? "rotate-180" : ""} />
        </span>
      </button>
      <div id="work-trace" hidden={!open} className="uw-rise mt-2 space-y-2">
        {children}
      </div>
    </div>
  );
}
