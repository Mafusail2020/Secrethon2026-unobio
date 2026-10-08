import { useState } from "react";
import type { TranslationLink } from "../../../../../api/types";
import { humanize } from "../../../../../lib/format";
import { ClaimCard } from "../ClaimCard";
import { useReportContext } from "../reportContext";

const STEPS: TranslationLink["step"][] = [
  "molecular_effect",
  "human_exposure",
  "target_engagement",
  "biological_response",
  "patient_benefit",
];

const STATUS_STYLE: Record<TranslationLink["status"], string> = {
  supported: "border-emerald-400 bg-emerald-50 text-emerald-900",
  weak: "border-amber-400 bg-amber-50 text-amber-900",
  missing: "border-slate-300 bg-slate-50 text-slate-600 border-dashed",
  contradicted: "border-red-400 bg-red-50 text-red-900",
};

/** The five links from molecule to patient benefit; a link with no data is shown as missing, never skipped. */
export function TranslationStepper({ chain }: { chain: TranslationLink[] }) {
  const { report } = useReportContext();
  const [open, setOpen] = useState<TranslationLink["step"] | undefined>();
  const byStep = new Map(chain.map((l) => [l.step, l]));
  const links = STEPS.map((step) => byStep.get(step) ?? { step, status: "missing" as const, claim_ids: [] });
  const claims = (open ? byStep.get(open)?.claim_ids : [])?.flatMap((id) => (report.claims[id] ? [report.claims[id]] : [])) ?? [];

  return (
    <section className="rounded-sm border border-line bg-surface p-3" aria-labelledby="chain-h">
      <h3 id="chain-h" className="text-base font-semibold">
        Will it work in humans? The translation chain
      </h3>
      <ol className="mt-2 grid grid-cols-1 gap-2 @xl:grid-cols-5">
        {links.map((link, i) => (
          <li key={link.step} className="relative">
            <button
              type="button"
              onClick={() => link.claim_ids.length && setOpen(open === link.step ? undefined : link.step)}
              aria-expanded={link.claim_ids.length ? open === link.step : undefined}
              className={`h-full w-full rounded-sm border p-2 text-left text-xs ${STATUS_STYLE[link.status]} ${link.claim_ids.length ? "cursor-pointer hover:shadow-sm" : "cursor-default"}`}
            >
              <span className="block text-[10px] uppercase tracking-wide opacity-70">Step {i + 1}</span>
              <span className="block font-medium">{humanize(link.step)}</span>
              <span className="block">{link.status}</span>
              <span className="block opacity-70">{link.claim_ids.length} claim{link.claim_ids.length === 1 ? "" : "s"}</span>
            </button>
          </li>
        ))}
      </ol>
      {open && (
        <ul className="mt-2 space-y-2">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} />
          ))}
        </ul>
      )}
    </section>
  );
}
