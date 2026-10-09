import { useId, useMemo, useState } from "react";
import type { UnderwritingReport } from "../../../../api/types";
import { SourcesIcon } from "../../../../components/ui/icons";
import { Chevron } from "../report/tree/Chevron";
import { Collapse } from "../report/tree/Collapse";
import { SourcesTable } from "./SourcesTable";
import { analysisSources, summarizeSources } from "./sourcesView";

const SHOWN_PUBLISHERS = 3;

/** What the analysis found on its own. Closed until asked for: most readers want their own files first. */
export function AnalysisSources({ report, onOpenClaim }: { report: UnderwritingReport; onOpenClaim: (claimId: string) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const found = useMemo(() => analysisSources(report), [report]);
  const { count, publishers } = useMemo(() => summarizeSources(found), [found]);
  const more = publishers.length - SHOWN_PUBLISHERS;
  const summary =
    count === 0
      ? "The analysis found no public sources."
      : `${count} ${count === 1 ? "source" : "sources"}: ${publishers.slice(0, SHOWN_PUBLISHERS).join(", ")}${more > 0 ? ` and ${more} more` : ""}`;

  return (
    <section aria-labelledby={`${uid}-title`} className="rounded-sm border border-line border-l-[6px] border-l-slate-400 bg-surface shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${uid}-body`}
        disabled={count === 0}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 rounded-sm p-4 text-left hover:bg-canvas/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default disabled:hover:bg-transparent"
      >
        <SourcesIcon width={20} height={20} className="shrink-0 text-slate-500" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span id={`${uid}-title`} className="text-base font-semibold">
              Found by the analysis
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-px text-[0.7rem] font-medium text-slate-600">Public sources</span>
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted">{summary}</span>
        </span>
        {count > 0 && (
          <>
            <span className="shrink-0 text-xs text-muted">{open ? "Hide" : "Show"}</span>
            <Chevron open={open} size="md" />
          </>
        )}
      </button>
      <Collapse open={open} id={`${uid}-body`}>
        <div className="border-t border-line/70">
          <SourcesTable report={found} onOpenClaim={onOpenClaim} />
        </div>
      </Collapse>
    </section>
  );
}
