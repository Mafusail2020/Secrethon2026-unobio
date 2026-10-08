import type { ReactNode } from "react";

export type Side = "for" | "against";

const TONE: Record<Side, { box: string; title: string; mark: string; sign: string }> = {
  for: { box: "border-emerald-300 bg-emerald-50", title: "text-emerald-900", mark: "bg-emerald-600", sign: "+" },
  against: { box: "border-red-300 bg-red-50", title: "text-red-900", mark: "bg-red-600", sign: "−" },
};

/**
 * One side of the case, in its own colour: green and plus for, red and minus against, the same everywhere in the report,
 * so a reader always knows which side of the argument they are looking at.
 */
export function SideBox({ side, title, count, children }: { side: Side; title: string; count: number; children: ReactNode }) {
  const tone = TONE[side];
  return (
    <div className={`min-w-0 rounded-xl border-2 p-3 ${tone.box}`}>
      <h4 className={`flex items-center gap-2 text-sm font-bold ${tone.title}`}>
        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none text-white ${tone.mark}`} aria-hidden="true">
          {tone.sign}
        </span>
        {title}
        <span className="ml-auto rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span>
      </h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** The few heaviest claims of a side as plain lines, for a card that is closed. */
export function Preview({ side, texts, more }: { side: Side; texts: string[]; more: number }) {
  const sign = side === "for" ? "+" : "−";
  const tone = side === "for" ? "text-emerald-700" : "text-red-700";
  if (texts.length === 0) return <p className="text-sm italic text-muted">Nothing found on this side.</p>;
  return (
    <ul className="space-y-1.5">
      {texts.map((t) => (
        <li key={t} className="flex gap-2 text-sm">
          <span className={`font-bold ${tone}`} aria-hidden="true">
            {sign}
          </span>
          <span className="line-clamp-2">{t}</span>
        </li>
      ))}
      {more > 0 && <li className="pl-5 text-xs text-muted">and {more} more</li>}
    </ul>
  );
}
