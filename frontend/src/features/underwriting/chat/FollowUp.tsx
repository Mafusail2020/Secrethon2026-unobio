import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, getApi } from "../../../api/client";
import { useMessages } from "../../../api/hooks";
import type { ChatMessage, UnderwritingReport } from "../../../api/types";
import { Spinner } from "../../../components/ui/Spinner";

/** Follow-up questions about a finished run. Answers cite claims of the report; a 501 or the question limit locks the input. */
export function FollowUp({
  runId,
  report,
  onOpenClaim,
}: {
  runId: string;
  report: UnderwritingReport;
  onOpenClaim: (claimId: string) => void;
}) {
  const queryClient = useQueryClient();
  const history = useMessages(runId);
  const [draft, setDraft] = useState("");
  const [locked, setLocked] = useState<"unavailable" | "limit" | null>(null);

  const ask = useMutation({
    mutationFn: async (content: string) =>
      (await getApi()).postMessage(runId, { role: "user", content, run_id: runId, cited_claim_ids: [] }),
    onSuccess: (reply, content) => {
      queryClient.setQueryData<ChatMessage[]>(["messages", runId], (old = []) => [
        ...old,
        { role: "user", content, run_id: runId, cited_claim_ids: [] },
        reply,
      ]);
      setDraft("");
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 501) setLocked("unavailable");
      if (error.status === 429) setLocked("limit");
    },
  });

  const messages = history.data ?? [];
  const notice =
    locked === "unavailable"
      ? "Follow-up questions are not available yet."
      : locked === "limit"
        ? "This run has reached its follow-up question limit."
        : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (content && !locked) ask.mutate(content);
  };

  return (
    <section aria-label="Follow-up questions" className="border-t border-line bg-surface p-3">
      {(messages.length > 0 || ask.isPending) && (
        <ul aria-live="polite" className="mb-2 max-h-48 space-y-2 overflow-auto">
          {messages.map((m, i) => (
            <li key={i} className={`rounded-lg p-2 text-sm ${m.role === "user" ? "ml-6 bg-navy text-white" : "mr-6 bg-canvas"}`}>
              <p>{m.content}</p>
              {m.cited_claim_ids.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1">
                  {m.cited_claim_ids.map((id) => {
                    const claim = report.claims[id];
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => onOpenClaim(id)}
                          className="max-w-[16rem] truncate rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-brand hover:border-brand"
                          title={claim?.text}
                        >
                          {claim ? claim.text : id}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
          {ask.isPending && (
            <li className="ml-6 rounded-lg bg-navy p-2 text-sm text-white opacity-70">
              <p>{ask.variables}</p>
            </li>
          )}
        </ul>
      )}
      {history.isError && <p role="status" className="mb-2 text-xs text-muted">Earlier questions could not be loaded.</p>}
      {notice && <p role="status" className="mb-2 text-xs text-amber-800">{notice}</p>}
      {ask.error && !locked && (
        <p role="alert" className="mb-2 text-xs text-red-700">
          {ask.error instanceof Error ? ask.error.message : "Could not send the question."}
        </p>
      )}
      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="sr-only" htmlFor="follow-up">
          Ask a follow-up question
        </label>
        <input
          id="follow-up"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!!locked || ask.isPending}
          placeholder={locked ? (locked === "limit" ? "Question limit reached" : "Follow-up questions are not available yet") : "Ask a follow-up about this report"}
          className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:bg-canvas"
        />
        <button
          type="submit"
          disabled={!!locked || ask.isPending || !draft.trim()}
          className="inline-flex items-center gap-1 rounded-full bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {ask.isPending && <Spinner className="h-3 w-3" />}
          Ask
        </button>
      </form>
    </section>
  );
}
