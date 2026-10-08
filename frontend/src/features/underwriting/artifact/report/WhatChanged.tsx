import { useDiff, useReportOf } from "../../../../api/hooks";
import type { UnderwritingReport } from "../../../../api/types";
import { buildDiffView } from "./diffView";
import { DiffSummaryFull } from "./DiffSummary";
import { useReportContext } from "./reportContext";

export function WhatChanged({ report, onJumpSection }: { report: UnderwritingReport; onJumpSection: (id: string) => void }) {
  const { jumpToClaim, runId } = useReportContext();
  const parentId = report.meta.parent_run_id;
  const diff = useDiff(parentId, runId, true);
  const before = useReportOf(parentId);
  if (!parentId) return null;
  if (diff.isPending || before.isPending) return <div className="h-24 animate-pulse rounded-lg bg-line/40" aria-busy="true" aria-label="Loading what changed" />;
  if (diff.error || !diff.data) return <p className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">Could not load what changed against the previous version.</p>;
  return <DiffSummaryFull view={buildDiffView(diff.data, before.data, report)} onJumpClaim={jumpToClaim} onJumpSection={onJumpSection} />;
}
