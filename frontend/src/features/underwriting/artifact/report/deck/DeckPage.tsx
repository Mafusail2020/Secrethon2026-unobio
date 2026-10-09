import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getApi } from "../../../../../api/client";
import { useDeckScript, useRunDetail } from "../../../../../api/hooks";
import { ErrorBox } from "../../../../../components/ui/ErrorBox";
import { Spinner } from "../../../../../components/ui/Spinner";
import { DeckSlides } from "./DeckSlides";
import { buildDeck } from "./deckModel";
import { SLIDE_H, SLIDE_W } from "./SlideFrame";

const PAGE_RULE = `@page { size: ${SLIDE_W}px ${SLIDE_H}px; margin: 0; }`;

/** While the deck is on screen: printing is one landscape slide per page, and the saved file is named after the program. */
function usePrintSetup(title: string | undefined) {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = PAGE_RULE;
    document.head.append(style);
    document.body.dataset.print = "deck";
    const before = document.title;
    return () => {
      style.remove();
      delete document.body.dataset.print;
      document.title = before;
    };
  }, []);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

function useFitScale(pad: number) {
  const stage = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - pad) / SLIDE_W)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pad]);
  return { stage, scale };
}

export default function DeckPage() {
  const { runId } = useParams();
  const detail = useRunDetail(runId);
  const report = detail.data?.report ?? undefined;
  const queryClient = useQueryClient();
  const script = useDeckScript(runId, !!report);
  // the deck waits for its words: showing the report's own wording first and swapping it makes the slides jump
  const deck = useMemo(() => (report && !script.isPending ? buildDeck(report, script.data) : undefined), [report, script.isPending, script.data]);
  const rewrite = useMutation({
    mutationFn: async () => (await getApi()).postDeck(runId!, true),
    onSuccess: (written) => queryClient.setQueryData(["deck", runId], written),
  });
  const { stage, scale } = useFitScale(48);
  usePrintSetup(report ? `${report.program.mechanism} in ${report.program.indication}: investment committee deck` : undefined);
  const back = `/underwriting/runs/${runId ?? ""}`;

  return (
    <div className="deck-root fixed inset-0 flex flex-col bg-slate-300">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-canvas px-4 py-2" data-print-hide>
        <Link to={back} className="rounded-sm text-sm font-medium text-royal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
          ← Back to the report
        </Link>
        <h1 className="text-sm font-semibold">Investment committee deck</h1>
        {deck && (
          <span className="text-xs text-muted">
            {deck.slides.length} slides,{" "}
            {deck.scripted
              ? "words by the model, figures from the report; every line cites a claim or a passage, or restates the report's numbers"
              : "in the report's own wording"}
          </span>
        )}
        {deck && !deck.scripted && script.isError && <span className="text-xs text-amber-800">The model could not be reached.</span>}
        <button
          type="button"
          disabled={!deck || rewrite.isPending}
          onClick={() => rewrite.mutate()}
          className="ml-auto rounded-sm border border-line bg-surface px-3 py-1.5 text-sm hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          title="Ask the model to write the words again"
        >
          {rewrite.isPending ? "Rewriting…" : "Rewrite"}
        </button>
        <button
          type="button"
          disabled={!deck}
          onClick={() => window.print()}
          className="rounded-sm bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-royal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          Save as PDF
        </button>
        <p className="basis-full text-xs text-muted">In the print window choose “Save as PDF”, and turn on background graphics.</p>
      </header>
      <div ref={stage} className="deck-stage min-h-0 flex-1 overflow-auto px-6 py-6">
        {report && script.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Writing the committee deck. With a live model this takes up to a minute.
          </p>
        )}
        {detail.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Loading the report
          </p>
        )}
        {detail.isError && <ErrorBox error={detail.error} title="Could not load the run" />}
        {detail.data && !report && <p className="text-sm">This run has no report yet, so there is nothing to put in a deck.</p>}
        {deck && report && (
          <div className="flex flex-col items-center gap-6">
            <DeckSlides deck={deck} kicker={`Unobio underwriting · ${report.program.mechanism}`} scale={scale} />
          </div>
        )}
      </div>
    </div>
  );
}
