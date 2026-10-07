import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, getApi } from "../../../api/client";
import type { ChatMessage, UnderwritingReport } from "../../../api/types";
import { Spinner } from "../../../components/ui/Spinner";

/** Follow-up questions about a finished run. Until the backend answers, the 501 disables the input. */
export function FollowUp({
  runId,
  report,
  onOpenClaim,
}: {
  runId: string;
  report: UnderwritingReport;
  onOpenClaim: (claimId: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const ask = useMutation({
    mutationFn: async (content: string) =>
      (await getApi()).postMessage(runId, { role: "user", content, run_id: runId, cited_claim_ids: [] }),
    onSuccess: (reply, content) => {
      setMessages((m) => [...m, { role: "user", content, run_id: runId, cited_claim_ids: [] }, reply]);
      setDraft("");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 501) {
        setUnavailable(true);
        setDraft("");
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (content && !unavailable) ask.mutate(content);
  };

  return (
    <section aria-label="Follow-up questions" className="border-t border-line bg-white p-3">
      {messages.length > 0 && (
        <ul className="mb-2 max-h-48 space-y-2 overflow-auto">
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
                          className="max-w-[16rem] truncate rounded-full border border-line bg-white px-2 py-0.5 text-xs text-brand hover:border-brand"
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
        </ul>
      )}
      {unavailable && <p role="status" className="mb-2 text-xs text-amber-800">Follow-up questions are not available yet.</p>}
      {ask.error && !unavailable && (
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
          disabled={unavailable || ask.isPending}
          placeholder={unavailable ? "Follow-up questions are not available yet" : "Ask a follow-up about this report"}
          className="min-w-0 flex-1 rounded-full border border-line bg-white px-3 py-1.5 text-sm placeholder:text-muted/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:bg-canvas"
        />
        <button
          type="submit"
          disabled={unavailable || ask.isPending || !draft.trim()}
          className="inline-flex items-center gap-1 rounded-full bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {ask.isPending && <Spinner className="h-3 w-3" />}
          Ask
        </button>
      </form>
    </section>
  );
}
