import { useEffect, useRef } from "react";
import type { GraphSpec, UnderwritingReport } from "../../../api/types";
import type { CorrectionSeed } from "../artifact/report/reportContext";
import { CorrectionForm } from "./CorrectionForm";

/** Modal wrapper (native <dialog>: focus trap and Esc come with it). Mount it to open it. */
export function CorrectionDialog({
  seed,
  runId,
  graph,
  report,
  canCorrect,
  onClose,
}: {
  seed: CorrectionSeed;
  runId: string;
  graph: GraphSpec;
  report: UnderwritingReport;
  canCorrect: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label={`Correct ${seed.node.label}`}
      className="m-auto w-[min(32rem,92vw)] rounded-xl border border-line bg-surface p-4 shadow-xl backdrop:bg-black/30"
    >
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={onClose} aria-label="close" className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <CorrectionForm
        runId={runId}
        node={seed.node}
        graph={graph}
        report={report}
        canCorrect={canCorrect}
        initialText={seed.text}
        initialExclude={seed.exclude}
        note={seed.note}
        onSubmitted={onClose}
      />
    </dialog>
  );
}
