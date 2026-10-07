import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getApi } from "../../../../api/client";
import { useNode } from "../../../../api/hooks";
import type { GraphSpec, NodeSpec, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { ErrorBox } from "../../../../components/ui/ErrorBox";
import { Spinner } from "../../../../components/ui/Spinner";
import { humanize } from "../../../../lib/format";
import { affectedSet, runnableNodes } from "../../graphUtils";
import type { RunStream } from "../../reduceEvents";
import { STATUS_ICON, STATUS_TEXT } from "../../status";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-48 overflow-auto rounded bg-canvas p-2 text-[11px] leading-snug">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CorrectionForm({
  runId,
  node,
  graph,
  report,
  canCorrect,
}: {
  runId: string;
  node: NodeSpec;
  graph: GraphSpec;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);

  const affected = affectedSet(graph, node.id);
  const total = runnableNodes(graph).length;

  const send = useMutation({
    mutationFn: async () =>
      (await getApi()).createCorrection(runId, node.id, {
        text: text.trim(),
        exclude_evidence_ids: excluded,
        add_notes: notes.trim() || undefined,
      }),
    onSuccess: (child) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/underwriting/runs/${child.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  if (!node.correctable) {
    return <p className="text-xs text-muted">This node is derived and cannot be corrected directly.</p>;
  }
  const evidence = report ? Object.values(report.evidence) : [];
  return (
    <form onSubmit={submit} className="space-y-2">
      <h4 className="text-sm font-semibold">Correct this node</h4>
      <textarea
        required
        rows={3}
        aria-label="correction"
        className="w-full rounded border border-line p-2 text-sm"
        placeholder="e.g. the earlier trials were terminated for safety reasons"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <textarea
        rows={2}
        aria-label="extra note"
        className="w-full rounded border border-line p-2 text-sm"
        placeholder="Optional: add a note as new user-provided evidence"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {evidence.length > 0 && (
        <details className="rounded border border-line p-2 text-xs">
          <summary className="cursor-pointer font-medium">Exclude evidence ({excluded.length})</summary>
          <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
            {evidence.map((e) => (
              <li key={e.id}>
                <label className="flex items-start gap-1">
                  <input
                    type="checkbox"
                    checked={excluded.includes(e.id)}
                    onChange={(ev) =>
                      setExcluded((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))
                    }
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
      {!canCorrect && <p className="text-xs text-amber-700">Corrections open once this run has completed.</p>}
      {send.error && <ErrorBox error={send.error} title="Could not start the corrected run" />}
      <button
        type="submit"
        disabled={!canCorrect || !text.trim() || send.isPending}
        className="inline-flex items-center gap-2 rounded-md bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {send.isPending && <Spinner className="h-3 w-3" />}
        Re-run with correction
      </button>
    </form>
  );
}

export function NodeDrawer({
  runId,
  node,
  graph,
  stream,
  report,
  canCorrect,
  onClose,
}: {
  runId: string | undefined;
  node: NodeSpec;
  graph: GraphSpec;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  onClose: () => void;
}) {
  const isContainer = graph.nodes.some((n) => n.parent === node.id);
  const live = stream.nodes[node.id];
  const status = live?.status ?? "pending";
  const detail = useNode(runId ?? "", runId && !isContainer ? node.id : undefined, status);
  const children = graph.nodes.filter((n) => n.parent === node.id);
  const sources = detail.data?.source_ids ?? [];

  return (
    <aside
      aria-label={`${node.label} details`}
      className="absolute right-0 top-0 z-10 h-full w-[26rem] max-w-full overflow-auto border-l border-line bg-white p-4 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{node.label}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge className="border-slate-300 text-slate-700">{node.kind}</Badge>
            {runId && !isContainer && (
              <Badge className={`border-slate-300 ${STATUS_TEXT[status]}`}>
                {STATUS_ICON[status]} {status}
              </Badge>
            )}
            {node.critical && <Badge className="border-red-300 text-red-700">critical</Badge>}
          </div>
        </div>
        <button onClick={onClose} aria-label="close" className="text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <p className="mt-2 text-sm">{node.description}</p>
      <div className="mt-1 text-xs text-muted">
        reads {node.reads.join(", ") || "nothing"} · writes {node.writes.join(", ") || "nothing"}
      </div>

      {isContainer && (
        <div className="mt-3 text-sm">
          <h4 className="font-semibold">Inner steps</h4>
          <ul className="list-disc pl-5">
            {children.map((c) => (
              <li key={c.id}>
                {c.label} <span className={STATUS_TEXT[stream.nodes[c.id]?.status ?? "pending"]}>{stream.nodes[c.id]?.status ?? "pending"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {runId && !isContainer && (
        <div className="mt-3 space-y-3">
          {detail.isFetching && !detail.data && <Spinner />}
          {live?.error && <ErrorBox error={new Error(live.error)} title="This step did not complete" />}
          {detail.data && (
            <>
              <section>
                <h4 className="text-sm font-semibold">Input</h4>
                <Json value={detail.data.input_summary} />
              </section>
              <section>
                <h4 className="text-sm font-semibold">Output</h4>
                <Json value={detail.data.output} />
              </section>
            </>
          )}
          <section>
            <h4 className="text-sm font-semibold">Log</h4>
            {(live?.logs.length ?? 0) === 0 ? (
              <p className="text-xs text-muted">no log lines yet</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {live?.logs.map((l) => (
                  <li key={l.seq} className={l.level === "error" ? "text-red-600" : l.level === "warn" ? "text-amber-600" : ""}>
                    {l.message}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {detail.data && detail.data.llm_calls.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">Model calls</h4>
              <ul className="text-xs">
                {detail.data.llm_calls.map((c, i) => (
                  <li key={i}>
                    {c.model} · {c.purpose} · {c.tokens_in}/{c.tokens_out} tokens · {c.cost_usd === null ? "cost unknown" : `$${c.cost_usd.toFixed(4)}`}
                    {c.cached ? " · cached" : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sources.length > 0 && (
            <section>
              <h4 className="text-sm font-semibold">Sources used</h4>
              <ul className="text-xs">
                {sources.map((id) => {
                  const source = report?.sources[id];
                  return (
                    <li key={id}>
                      {source ? (
                        source.url ? (
                          <a className="text-brand hover:underline" href={source.url} target="_blank" rel="noreferrer">
                            {source.title}
                          </a>
                        ) : (
                          source.title
                        )
                      ) : (
                        id
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {runId && (
        <div className="mt-4 border-t border-line pt-3">
          <CorrectionForm runId={runId} node={node} graph={graph} report={report} canCorrect={canCorrect} />
        </div>
      )}
    </aside>
  );
}
