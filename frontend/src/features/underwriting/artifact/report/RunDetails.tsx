import type { RunMeta } from "../../../../api/types";
import { formatCost, formatTokens } from "../../../../lib/format";

export function RunDetails({ meta, runId }: { meta: RunMeta; runId: string }) {
  const rows: [string, string][] = [
    ["Run", runId],
    ["Models", meta.models_used.join(", ") || "no model calls"],
    ["Effort", meta.panel_size ? `${meta.effort} (panel of ${meta.panel_size})` : meta.effort],
    ["Tokens", `${formatTokens(meta.tokens_in)} in, ${formatTokens(meta.tokens_out)} out`],
    ["Cost", meta.models_used.every((m) => m.startsWith("mock/")) && meta.models_used.length ? "mock model, no spend" : formatCost(meta.cost_usd)],
    ["Duration", `${meta.duration_s}s`],
    ["Cache hits", String(meta.cache_hits)],
  ];
  return (
    <section className="rounded-lg border border-line bg-surface p-3" aria-labelledby="run-h">
      <h3 id="run-h" className="text-sm font-semibold">
        Run details
      </h3>
      {meta.failed_nodes.length > 0 && (
        <p role="alert" className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Degraded run: {meta.failed_nodes.join(", ")} did not complete, so parts of this report rest on less evidence than usual.
        </p>
      )}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
