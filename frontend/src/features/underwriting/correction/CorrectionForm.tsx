import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApi } from "../../../api/client";
import type { GraphSpec, NodeSpec, UnderwritingReport } from "../../../api/types";
import { ErrorBox } from "../../../components/ui/ErrorBox";
import { Spinner } from "../../../components/ui/Spinner";
import { humanize } from "../../../lib/format";
import { affectedSet, runnableNodes } from "../graphUtils";

/** Correct one node and re-run. Shared by the graph drawer and the report's "This is wrong". */
export function CorrectionForm({
  runId,
  node,
  graph,
  report,
  canCorrect,
  initialText = "",
  initialExclude = [],
  note,
  disabledReason,
  onSubmitted,
}: {
  runId: string;
  node: NodeSpec;
  graph: GraphSpec;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  initialText?: string;
  initialExclude?: string[];
  /** why this node was chosen, when it is not the obvious one */
  note?: string;
  /** why corrections are unavailable right now, shown instead of the default explanation */
  disabledReason?: string;
  onSubmitted?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState(initialText);
  const [extra, setExtra] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [excluded, setExcluded] = useState<string[]>(initialExclude);

  const affected = affectedSet(graph, node.id);
  const total = runnableNodes(graph).length;
  const evidence = report ? Object.values(report.evidence) : [];

  const send = useMutation({
    mutationFn: async () =>
      (await getApi()).createCorrection(runId, node.id, {
        text: text.trim(),
        exclude_evidence_ids: excluded,
        add_notes: extra.trim() || undefined,
      }),
    onSuccess: (child) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      onSubmitted?.();
      navigate(`/underwriting/runs/${child.id}`, { state: { panel: "graph" } });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (!node.correctable) {
    return <p className="text-xs text-muted">This step is derived and cannot be corrected directly.</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <h4 className="text-sm font-semibold">Correct {node.label}</h4>
      {note && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{note}</p>}
      <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
        <button
          type="button"
          onClick={() => setText((t) => (t.includes("I disagree with this output") ? t : `I disagree with this output: ${t}`))}
          className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-brand"
        >
          Disagree with this output
        </button>
        <button type="button" onClick={() => setShowExtra((s) => !s)} aria-pressed={showExtra} className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-brand">
          Add a note
        </button>
      </div>
      <textarea
        required
        rows={3}
        aria-label="correction"
        className="w-full rounded-md border border-line p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        placeholder="What is wrong, and why? For example: the earlier trials were terminated for safety reasons."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {showExtra && (
        <textarea
          rows={2}
          aria-label="extra note"
          className="w-full rounded-md border border-line p-2 text-sm"
          placeholder="Optional: add a note as new user-provided evidence"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
      )}
      {evidence.length > 0 && (
        <details className="rounded-md border border-line p-2 text-xs" open={initialExclude.length > 0 || undefined}>
          <summary className="cursor-pointer font-medium">Exclude evidence ({excluded.length})</summary>
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
            {evidence.map((e) => (
              <li key={e.id}>
                <label className="flex items-start gap-1">
                  <input
                    type="checkbox"
                    checked={excluded.includes(e.id)}
                    onChange={(ev) => setExcluded((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))}
                  />
                  <span>
                    {report?.sources[e.source_id]?.title}: {e.excerpt.slice(0, 80)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-muted">
        Recomputes {affected.size} of {total} steps ({[...affected].map(humanize).join(", ")}); the rest are reused.
      </p>
      {!canCorrect && <p role="status" className="text-xs text-amber-700">{disabledReason ?? "Corrections open once this run has completed."}</p>}
      {send.error && <ErrorBox error={send.error} title="Could not start the corrected run" />}
      <button
        type="submit"
        disabled={!canCorrect || !text.trim() || send.isPending}
        className="inline-flex items-center gap-2 rounded-full bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {send.isPending && <Spinner className="h-3 w-3" />}
        Re-run with correction
      </button>
    </form>
  );
}
