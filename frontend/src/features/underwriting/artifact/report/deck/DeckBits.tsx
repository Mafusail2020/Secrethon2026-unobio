import { STANCE_STYLE } from "../claimStyles";
import type { DeckLine } from "./deckModel";

export function Pill({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] font-medium ${className}`}>{children}</span>;
}

/** A label above a figure, the way a term sheet sets out its numbers. */
export function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-[13px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="font-serif text-[40px] leading-none tracking-tight">{value}</p>
      {note && <p className="mt-1 text-[13px] text-muted">{note}</p>}
    </div>
  );
}

const SIDE_EDGE = { for: "border-l-emerald-500", against: "border-l-red-500" } as const;
const SIDE_TITLE = { for: "text-emerald-800", against: "text-red-800" } as const;

/** Statements for or against, each with its label and the sources behind it. */
export function Statements({ side, title, lines, empty }: { side: "for" | "against"; title: string; lines: DeckLine[]; empty: string }) {
  return (
    <div className={`rounded-sm border border-line border-l-[6px] bg-surface/70 px-5 py-4 ${SIDE_EDGE[side]}`}>
      <h3 className={`text-[17px] font-semibold ${SIDE_TITLE[side]}`}>{title}</h3>
      {lines.length === 0 ? (
        <p className="mt-2 text-[16px] italic text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {lines.map((l) => (
            <li key={l.claimId} className="text-[17px] leading-snug">
              {l.text}
              <span className="mt-0.5 block text-[12px] text-muted">
                {l.label && <span className={`mr-1.5 rounded-full border px-1.5 py-px ${STANCE_STYLE.neutral}`}>{l.label}</span>}
                {l.cites.length > 0 ? l.cites.slice(0, 2).join(", ") + (l.cites.length > 2 ? ` and ${l.cites.length - 2} more` : "") : "no source cited"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the figures on a slide mean, in a few cited lines. */
export function Reading({ lines }: { lines: DeckLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-sm border border-line bg-surface/70 px-5 py-3" aria-label="What it means">
      {lines.map((l) => (
        <li key={`${l.claimId}-${l.text}`} className="flex gap-2 text-[17px] leading-snug">
          <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <span>
            {l.text}
            {l.cites.length > 0 && <span className="ml-2 text-[12px] text-muted">{l.cites.slice(0, 2).join(", ")}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
