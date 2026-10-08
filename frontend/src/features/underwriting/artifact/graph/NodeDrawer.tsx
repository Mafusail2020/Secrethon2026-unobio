import { useState } from "react";
import { useNode } from "../../../../api/hooks";
import type { GraphSpec, NodeExecution, NodeSpec, RunSummary, UnderwritingReport } from "../../../../api/types";
import { Badge } from "../../../../components/ui/Badge";
import { ErrorBox } from "../../../../components/ui/ErrorBox";
import { InfoTip } from "../../../../components/ui/InfoTip";
import { Spinner } from "../../../../components/ui/Spinner";
import { Tabs } from "../../../../components/ui/Tabs";
import { formatCost, formatDuration, humanize } from "../../../../lib/format";
import { CorrectionForm } from "../../correction/CorrectionForm";
import type { RunStream } from "../../reduceEvents";
import { STATUS_ICON, STATUS_TEXT } from "../../status";
import { kindLabel, kindMeaning } from "./kindStyle";
import { summarizeOutput } from "./outputSummary";
import { ValueTree } from "./ValueTree";

export type DrawerTab = "overview" | "output" | "log" | "correct";

function Chips({ items, empty }: { items: string[]; empty: string }) {
  return items.length === 0 ? (
    <span className="text-muted">{empty}</span>
  ) : (
    <span className="inline-flex flex-wrap gap-1">
      {items.map((i) => (
        <code key={i} className="rounded bg-canvas px-1 py-0.5 text-[11px]">
          {i}
        </code>
      ))}
    </span>
  );
}

function SourcesUsed({ ids, report }: { ids: string[]; report: UnderwritingReport | undefined }) {
  if (ids.length === 0) return <p className="text-xs text-muted">This step registered no sources.</p>;
  return (
    <ul className="space-y-1.5 text-xs">
      {ids.map((id) => {
        const source = report?.sources[id];
        const quotes = report ? Object.values(report.evidence).filter((e) => e.source_id === id) : [];
        return (
          <li key={id}>
            <details>
              <summary className="cursor-pointer">
                {source ? (
                  <>
                    <span className="font-medium">{source.title}</span> <span className="text-muted">({quotes.length} evidence)</span>
                  </>
                ) : (
                  <code>{id}</code>
                )}
              </summary>
              <div className="mt-1 space-y-1 pl-3">
                {source?.url && (
                  <a className="text-brand hover:underline" href={source.url} target="_blank" rel="noreferrer">
                    {source.publisher}: open source
                  </a>
                )}
                {!source && <p className="text-muted">Not part of this report.</p>}
                {quotes.map((q) => (
                  <blockquote key={q.id} className="border-l-2 border-brand pl-2 italic">
                    {q.excerpt}
                  </blockquote>
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function LlmCalls({ calls }: { calls: NodeExecution["llm_calls"] }) {
  if (calls.length === 0) return <p className="text-xs text-muted">No model calls.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <caption className="sr-only">Model calls</caption>
        <thead className="text-muted">
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Purpose</th>
            <th scope="col" className="text-right">Tokens in/out</th>
            <th scope="col" className="text-right">Cost</th>
            <th scope="col" className="text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} className="border-t border-line align-top">
              <td className="py-0.5 pr-1">
                {c.model}
                {c.cached && <Badge className="ml-1 border-slate-300 text-slate-600">cached</Badge>}
              </td>
              <td className="pr-1">{c.purpose}</td>
              <td className="text-right tabular-nums">
                {c.tokens_in}/{c.tokens_out}
              </td>
              <td className="text-right">{c.model.startsWith("mock/") ? "mock" : formatCost(c.cost_usd)}</td>
              <td className="text-right tabular-nums">{formatDuration(c.latency_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutputView({ output }: { output: NodeExecution["output"] }) {
  const entries = summarizeOutput(output);
  if (entries.length === 0) return <p className="text-xs text-muted">This step produced no output.</p>;
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.key}>
          {entry.kind === "ids" && (
            <div className="text-xs">
              <span className="font-medium">
                {entry.ids.length + entry.more} {entry.label}
              </span>
              <div className="mt-0.5">
                <Chips items={entry.ids} empty="none" />
                {entry.more > 0 && <span className="text-muted"> and {entry.more} more</span>}
              </div>
            </div>
          )}
          {entry.kind === "count" && (
            <div className="text-xs">
              <span className="font-medium">
                {entry.count} {entry.label}
              </span>
            </div>
          )}
          {entry.kind === "value" && <ValueTree value={entry.value} label={humanize(entry.key)} />}
        </li>
      ))}
    </ul>
  );
}

function LogView({ lines }: { lines: { seq: number; level: string; message: string }[] }) {
  const [level, setLevel] = useState("all");
  const shown = lines.filter((l) => level === "all" || l.level === level);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          Level
          <select className="rounded border border-line px-1" value={level} onChange={(e) => setLevel(e.target.value)}>
            {["all", "info", "warn", "error"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(shown.map((l) => l.message).join("\n"))} className="ml-auto text-brand hover:underline">
          Copy
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-muted">No log lines.</p>
      ) : (
        <ul className="space-y-0.5 font-mono text-[11px]">
          {shown.map((l) => (
            <li key={l.seq} className={l.level === "error" ? "text-red-700" : l.level === "warn" ? "text-amber-700" : ""}>
              {l.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NodeDrawer({
  run,
  node,
  graph,
  stream,
  report,
  canCorrect,
  tab,
  onTab,
  onClose,
}: {
  run: RunSummary | undefined;
  node: NodeSpec;
  graph: GraphSpec;
  stream: RunStream;
  report: UnderwritingReport | undefined;
  canCorrect: boolean;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
}) {
  const children = graph.nodes.filter((n) => n.parent === node.id);
  const isContainer = children.length > 0;
  const live = stream.nodes[node.id];
  const status = live?.status ?? "pending";
  const detail = useNode(run?.id ?? "", run && !isContainer ? node.id : undefined, status);
  const execution = detail.data;
  const tabs: { id: DrawerTab; label: string }[] = isContainer
    ? [
        { id: "overview", label: "Overview" },
        { id: "correct", label: "Correct" },
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "output", label: "Output" },
        { id: "log", label: `Log${live?.logs.length ? ` (${live.logs.length})` : ""}` },
        { id: "correct", label: "Correct" },
      ];
  const active = tabs.some((t) => t.id === tab) ? tab : "overview";

  const disabledReason =
    run?.status === "failed"
      ? "This run failed, so it cannot be corrected. Run it again first."
      : run && run.status !== "completed"
        ? "This run is still going. Corrections open once it has completed."
        : undefined;

  return (
    <aside
      aria-label={`${node.label} details`}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="flex h-full w-full flex-col border-l border-line bg-surface shadow-lg"
    >
      <div className="border-b border-line p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{node.label}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <InfoTip title={kindLabel(node.kind)} body={kindMeaning(node.kind)}>
                <Badge className="border-slate-300 text-slate-700">{kindLabel(node.kind)}</Badge>
              </InfoTip>
              {run && !isContainer && (
                <Badge className={`border-slate-300 ${STATUS_TEXT[status]}`}>
                  {STATUS_ICON[status]} {status}
                  {live?.durationMs ? ` · ${formatDuration(live.durationMs)}` : ""}
                </Badge>
              )}
              {node.critical && <Badge className="border-red-300 text-red-700">critical</Badge>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <Tabs tabs={tabs} active={active} onChange={onTab} idPrefix="drawer" label="Step details" variant="pill" />
      </div>

      <div role="tabpanel" id="drawer-panel" aria-labelledby={`drawer-${active}`} className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {active === "overview" && (
          <>
            <p className="text-sm">{node.description}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">Reads</dt>
              <dd>
                <Chips items={node.reads} empty="nothing" />
              </dd>
              <dt className="text-muted">Writes</dt>
              <dd>
                <Chips items={node.writes} empty="nothing" />
              </dd>
              {execution?.correction_ids.length ? (
                <>
                  <dt className="text-muted">Corrections</dt>
                  <dd>{execution.correction_ids.length} applied to this step</dd>
                </>
              ) : null}
            </dl>
            {isContainer && (
              <div>
                <h4 className="text-sm font-semibold">Inner steps</h4>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {children.map((c) => {
                    const s = stream.nodes[c.id]?.status ?? "pending";
                    return (
                      <li key={c.id} className="flex items-center gap-1.5">
                        <span className={STATUS_TEXT[s]} aria-hidden="true">
                          {STATUS_ICON[s]}
                        </span>
                        {c.label} <span className="text-muted">{s}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {run && !isContainer && (
              <>
                {detail.isFetching && !execution && <Spinner />}
                {live?.error && <ErrorBox error={new Error(live.error)} title={status === "skipped" ? "This step was skipped" : "This step did not complete"} />}
                {execution && (
                  <>
                    <section>
                      <h4 className="mb-1 text-sm font-semibold">Sources used</h4>
                      <SourcesUsed ids={execution.source_ids} report={report} />
                    </section>
                    <section>
                      <h4 className="mb-1 text-sm font-semibold">Model calls</h4>
                      <LlmCalls calls={execution.llm_calls} />
                    </section>
                  </>
                )}
              </>
            )}
            {!run && <p className="text-xs text-muted">Run an underwriting to see how this step performs.</p>}
          </>
        )}

        {active === "output" && (
          <>
            {!execution && detail.isFetching && <Spinner />}
            {execution && (
              <>
                <section>
                  <h4 className="mb-1 text-sm font-semibold">Output</h4>
                  <OutputView output={execution.output} />
                </section>
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">Input this step saw</summary>
                  <div className="mt-1">
                    <ValueTree value={execution.input_summary} />
                  </div>
                </details>
              </>
            )}
            {!execution && !detail.isFetching && <p className="text-xs text-muted">This step has not produced output yet.</p>}
          </>
        )}

        {active === "log" && <LogView lines={live?.logs ?? execution?.log.map((l, i) => ({ seq: i, level: l.level, message: l.message })) ?? []} />}

        {active === "correct" &&
          (run ? (
            <CorrectionForm runId={run.id} node={node} graph={graph} report={report} canCorrect={canCorrect} disabledReason={disabledReason} />
          ) : (
            <p className="text-xs text-muted">Run an underwriting first; corrections apply to a finished run.</p>
          ))}
      </div>
    </aside>
  );
}
