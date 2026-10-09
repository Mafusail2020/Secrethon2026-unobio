import type { ReactNode } from "react";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export const SYNTHETIC_WARNING = "Synthetic data: this deck is built from placeholder content and is not an assessment of a real program.";

interface FrameProps {
  title: string;
  kicker: string;
  index: number;
  total: number;
  sources: string[];
  synthetic: boolean;
  children: ReactNode;
}

/** One landscape page: a fixed 1280 by 720 box, so what is on screen is what prints. */
export function SlideFrame({ title, kicker, index, total, sources, synthetic, children }: FrameProps) {
  return (
    <section
      aria-label={`Slide ${index} of ${total}: ${title}`}
      className="deck-slide relative flex flex-col overflow-hidden bg-white px-16 pb-5 pt-11 text-ink"
      style={{ width: SLIDE_W, height: SLIDE_H }}
    >
      <span className="absolute inset-y-0 left-0 w-2 bg-brand" aria-hidden="true" />
      <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-muted">{kicker}</p>
      <h2 className="mt-1 text-[40px] font-semibold leading-[1.1] tracking-tight">{title}</h2>
      <div className="min-h-0 flex-1 pt-6">{children}</div>
      <footer className="flex items-end justify-between gap-8 border-t border-line pt-2 text-[11px] leading-snug text-muted">
        <p className="min-w-0 flex-1">
          {sources.length > 0 && (
            <>
              <span className="font-medium">Sources: </span>
              {sources.join(" · ")}
            </>
          )}
          {synthetic && <span className="mt-0.5 block font-medium text-red-700">{SYNTHETIC_WARNING}</span>}
        </p>
        <span className="shrink-0 tabular-nums">
          {index} / {total}
        </span>
      </footer>
    </section>
  );
}
