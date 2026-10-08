import type { ReactNode } from "react";

export type Side = "for" | "against";

const TONE: Record<Side, { box: string; title: string }> = {
  for: { box: "border-emerald-300 bg-emerald-50", title: "text-emerald-900" },
  against: { box: "border-red-300 bg-red-50", title: "text-red-900" },
};

/**
 * One side of the case, in its own colour: green for, red against, the same everywhere in the report, so a reader always
 * knows which side of the argument they are looking at. Colour and the title say it; there are no signs or counts.
 */
export function SideBox({ side, title, children }: { side: Side; title: string; children: ReactNode }) {
  const tone = TONE[side];
  return (
    <div className={`min-w-0 rounded-sm border-2 p-3 ${tone.box}`}>
      <h4 className={`text-base font-bold ${tone.title}`}>{title}</h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** The few heaviest claims of a side as plain lines, for a card that is closed. */
export function Preview({ texts, more }: { texts: string[]; more: number }) {
  if (texts.length === 0) return <p className="text-sm italic text-muted">Nothing found on this side.</p>;
  return (
    <ul className="space-y-1.5">
      {texts.map((t) => (
        <li key={t} className="text-sm">
          <span className="line-clamp-2">{t}</span>
        </li>
      ))}
      {more > 0 && <li className="text-xs text-muted">and {more} more</li>}
    </ul>
  );
}
