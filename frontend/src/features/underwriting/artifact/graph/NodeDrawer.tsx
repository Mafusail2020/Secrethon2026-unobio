import { useNode } from "../../../../api/hooks";
import type { GraphSpec, NodeSpec, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { ErrorBox } from "../../../../components/ui/ErrorBox";
import { Spinner } from "../../../../components/ui/Spinner";
import { CorrectionForm } from "../../correction/CorrectionForm";
import type { RunStream } from "../../reduceEvents";
import { STATUS_ICON, STATUS_TEXT } from "../../status";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-48 overflow-auto rounded bg-canvas p-2 text-[11px] leading-snug">
      {JSON.stringify(value, null, 2)}
    </pre>
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
