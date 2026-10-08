import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, getApi } from "../../../api/client";
import { useMessages } from "../../../api/hooks";
import type { ChatMessage } from "../../../api/types";

export type FollowUpLock = "unavailable" | "limit" | null;

/** One follow-up conversation per run; the thread and the input read the same state. */
export function useFollowUp(runId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const history = useMessages(runId, enabled);
  const [locked, setLocked] = useState<FollowUpLock>(null);

  const ask = useMutation({
    mutationFn: async (content: string) =>
      (await getApi()).postMessage(runId, { role: "user", content, run_id: runId, cited_claim_ids: [] }),
    onSuccess: (reply, content) => {
      queryClient.setQueryData<ChatMessage[]>(["messages", runId], (old = []) => [
        ...old,
        { role: "user", content, run_id: runId, cited_claim_ids: [] },
        reply,
      ]);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.status === 501) setLocked("unavailable");
      if (error.status === 429) setLocked("limit");
    },
  });

  return { messages: history.data ?? [], historyFailed: history.isError, ask, locked };
}

export type FollowUp = ReturnType<typeof useFollowUp>;
