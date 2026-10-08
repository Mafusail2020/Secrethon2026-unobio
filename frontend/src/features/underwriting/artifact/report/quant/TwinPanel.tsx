import type { TwinStats, UnderwritingReport } from "../../../../../api/types";
import { Badge } from "../../../../../components/ui/Badge";
import { pctRange } from "../../../../../lib/format";
import { BarList } from "./BarList";
import { RangeBar } from "./RangeBar";
import { groupStopReasons, hasGuessedGroups, sortStages, STOP_GROUP_LABEL } from "../twinView";

const MATCH: Record<TwinStats["match_level"], string> = {
  exact_target_indication: "Same target and indication",
  target_area: "Same target, related therapeutic area",
  target_any: "Same target, any indication",
  target_class: "Same target class",
  area_base_rate: "Base rate for the therapeutic area only",
};

const STATUS: Record<TwinStats["twins"][number]["status"], string> = {
  approved: "border-emerald-300 bg-emerald-50 text-emerald-800",
  stopped: "border-red-300 bg-red-50 text-red-700",
  active: "border-blue-300 bg-blue-50 text-blue-800",
  unknown: "border-slate-300 bg-slate-50 text-slate-600",
};

export function TwinPanel({ twin, report }: { twin: TwinStats; report: UnderwritingReport }) {
  const stages = sortStages(twin.stage_distribution);
  const stops = groupStopReasons(twin.stop_reasons, twin.stop_reason_categories);
  const guessed = hasGuessedGroups(twin.stop_reasons, twin.stop_reason_categories);
  return (
    <section className="rounded-lg border border-line bg-white p-3" aria-labelledby="twin-h">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="twin-h" className="text-sm font-semibold">
          Similar programs
        </h3>
        <Badge className="border-slate-300 text-slate-700">{MATCH[twin.match_level]}</Badge>
        <span className="text-xs text-muted">
          {twin.n_programs} program{twin.n_programs === 1 ? "" : "s"}
        </span>
      </div>
      {twin.n_programs < 3 && (
        <p role="note" className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          Thin history: with only {twin.n_programs} similar program{twin.n_programs === 1 ? "" : "s"} this prior is weak. Treat the range as a starting point.
        </p>
      )}
      <div className="mt-3">
        <RangeBar range={twin.prior_pos} format={(v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`} label="Prior probability of success" min={0} />
        <p className="sr-only">{pctRange(twin.prior_pos)}</p>
      </div>

      <div className="mt-3 grid gap-4 @2xl:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted">Furthest stage reached</h4>
          {stages.length ? <BarList items={stages.map((s) => ({ label: s.stage, value: s.count }))} /> : <p className="text-xs text-muted">No stage data.</p>}
        </div>
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted">Why programs stopped</h4>
          {stops.length ? (
            <div className="space-y-2">
              {stops.map((g) => (
                <div key={g.group}>
                  <div className="text-xs font-medium">
                    {STOP_GROUP_LABEL[g.group]} <span className="text-muted">({g.total})</span>
                  </div>
                  <BarList items={g.items.map((i) => ({ label: i.reason, value: i.count }))} tone={g.group === "safety" ? "fill-red-500" : g.group === "efficacy" ? "fill-amber-500" : "fill-slate-400"} />
                </div>
              ))}
              {guessed && <p className="text-[11px] text-muted">Reasons without a category from the source are grouped by keyword.</p>}
            </div>
          ) : (
            <p className="text-xs text-muted">No stop reasons recorded.</p>
          )}
        </div>
      </div>

      {twin.twins.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <caption className="sr-only">Similar programs</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-1">Program</th>
                <th scope="col">Indication</th>
                <th scope="col">Furthest stage</th>
                <th scope="col">Status</th>
                <th scope="col">Sources</th>
              </tr>
            </thead>
            <tbody>
              {twin.twins.map((t) => (
                <tr key={t.drug_id} className="border-t border-line align-top">
                  <td className="py-1 pr-2 font-medium">{t.drug}</td>
                  <td className="pr-2">{t.disease}</td>
                  <td className="pr-2">{t.max_stage}</td>
                  <td className="pr-2">
                    <Badge className={STATUS[t.status]}>{t.status}</Badge>
                    {t.stop_reason && <div className="mt-0.5 text-muted">{t.stop_reason}</div>}
                  </td>
                  <td>
                    {t.source_ids.length === 0 && <span className="text-muted">none</span>}
                    {t.source_ids.map((id) => {
                      const source = report.sources[id];
                      return source?.url ? (
                        <a key={id} href={source.url} target="_blank" rel="noreferrer" className="block text-brand hover:underline">
                          {source.identifiers.nct ?? source.title}
                        </a>
                      ) : (
                        <span key={id} className="block text-muted" title="Source not part of this report">
                          {id}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {twin.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-xs text-muted">
          {twin.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
