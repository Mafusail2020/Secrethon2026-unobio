import type { UnderwritingReport } from "../../../../../api/types";
import type { FocusClaim } from "../reportContext";
import type { QuestionId, ReportTree } from "../reportTree";
import { QuestionCard } from "./QuestionCard";
import { RootSummary } from "./RootSummary";

/** The report as a tree: the call, then the four questions under it, each opening to its case for and against. */
export function ReportTreeView({
  report,
  tree,
  open,
  onToggle,
  onSetAll,
  focus,
}: {
  report: UnderwritingReport;
  tree: ReportTree;
  open: ReadonlySet<QuestionId>;
  onToggle: (id: QuestionId) => void;
  onSetAll: (open: boolean) => void;
  focus: FocusClaim | undefined;
}) {
  const scale = Math.max(1, ...tree.questions.flatMap((q) => [q.balance.pro, q.balance.con]));
  const allOpen = tree.questions.every((q) => open.has(q.id));
  return (
    <div className="space-y-4">
      <RootSummary report={report} tree={tree} scale={scale * 3} />
      <div className="flex items-center justify-between" data-print-hide>
        <h2 className="text-sm font-semibold">The case, question by question</h2>
        <button
          type="button"
          onClick={() => onSetAll(!allOpen)}
          className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="space-y-3">
        {tree.questions.map((q) => (
          <QuestionCard key={q.id} node={q} scale={scale} open={open.has(q.id)} onToggle={() => onToggle(q.id)} focus={focus} />
        ))}
      </div>
    </div>
  );
}
