import type { UnderwritingReport } from "../../../../../api/types";
import { BarList } from "../quant/BarList";
import { sourceMix } from "./chartData";

/** Which kinds of source the claims cite. A report that leans on one kind says so at a glance. */
export function SourceMix({ report }: { report: UnderwritingReport }) {
  const mix = sourceMix(report);
  if (mix.length === 0) return null;
  return (
    <section className="rounded-sm border border-line bg-surface p-3" aria-labelledby="sources-h">
      <h3 id="sources-h" className="text-base font-semibold">
        Where the evidence comes from
      </h3>
      <p className="mb-2 text-xs text-muted">Sources the claims cite, by kind.</p>
      <BarList items={mix.map((m) => ({ label: m.label, value: m.value }))} />
    </section>
  );
}
