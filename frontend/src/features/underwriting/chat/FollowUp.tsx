import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { UnderwritingReport } from "../../../api/types";
import { ArrowUpIcon } from "../../../components/ui/icons";
import { Spinner } from "../../../components/ui/Spinner";
import { ClaimChips } from "./ClaimChips";
import { PassageChips } from "./PassageChips";
import type { FollowUp } from "./useFollowUp";

const NOTICE = {
  unavailable: "Follow-up questions are not available yet.",
  limit: "This run has reached its follow-up question limit.",
} as const;

/** The follow-up thread: earlier questions, the one in flight, and what went wrong. Claims in answers jump to the report. */
export function FollowUpMessages({
  follow,
  report,
  onOpenClaim,
}: {
  follow: FollowUp;
  report: UnderwritingReport | undefined;
  onOpenClaim: (claimId: string) => void;
}) {
  const { messages, ask, locked, historyFailed } = follow;
  const notice = locked ? NOTICE[locked] : null;
  if (!messages.length && !ask.isPending && !notice && !ask.error && !historyFailed) return null;

  return (
    <section aria-label="Follow-up questions" className="space-y-5">
      <ul aria-live="polite" className="space-y-5">
        {messages.map((m, i) => (
          <li key={i} className={`uw-rise ${m.role === "user" ? "flex justify-end" : ""}`}>
            {m.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-100 px-4 py-2.5 text-[0.95rem]">{m.content}</p>
            ) : (
              <div className="text-[0.95rem] leading-relaxed">
                <p className="whitespace-pre-wrap">{m.content}</p>
                <ClaimChips ids={m.cited_claim_ids} report={report} onOpen={onOpenClaim} />
                <PassageChips ids={m.cited_evidence_ids} />
              </div>
            )}
          </li>
        ))}
        {ask.isPending && (
          <>
            <li className="uw-rise flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-slate-100 px-4 py-2.5 text-[0.95rem] opacity-70">{ask.variables}</p>
            </li>
            <li className="uw-fade flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-3.5 w-3.5" /> Reading the report…
            </li>
          </>
        )}
      </ul>
      {historyFailed && <p role="status" className="text-xs text-muted">Earlier questions could not be loaded.</p>}
      {notice && <p role="status" className="text-xs text-amber-800">{notice}</p>}
      {ask.error && !locked && (
        <p role="alert" className="text-xs text-red-700">
          {ask.error instanceof Error ? ask.error.message : "Could not send the question."}
        </p>
      )}
    </section>
  );
}

/** Reply box docked under the thread. It is visible while a run is going, and opens when the report exists. */
export function FollowUpInput({ follow, ready }: { follow: FollowUp; ready: boolean }) {
  const { ask, locked } = follow;
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const closed = !ready || !!locked;

  // grow with the text up to a few lines
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const content = draft.trim();
    if (content && !closed && !ask.isPending) ask.mutate(content, { onSuccess: () => setDraft("") });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const placeholder = locked
    ? locked === "limit"
      ? "Question limit reached"
      : "Follow-up questions are not available yet"
    : ready
      ? "Ask a follow-up about this report"
      : "Follow-up questions open when the analysis completes";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-1">
      <form
        onSubmit={submit}
        className={`flex items-end gap-2 rounded-lg border bg-surface py-2 pl-5 pr-2 shadow-sm transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 ${closed ? "border-line/70 opacity-80" : "border-line"}`}
      >
        <label className="sr-only" htmlFor="follow-up">
          Ask a follow-up question
        </label>
        <textarea
          id="follow-up"
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={closed || ask.isPending}
          maxLength={2000}
          placeholder={placeholder}
          className="uw-bare max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[0.95rem] placeholder:text-muted/70 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Send question"
          disabled={closed || ask.isPending || !draft.trim()}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-royal text-white transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:bg-slate-300 disabled:text-white"
        >
          {ask.isPending ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpIcon width={18} height={18} />}
        </button>
      </form>
    </div>
  );
}
