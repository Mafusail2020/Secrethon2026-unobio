import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useHealth } from "../../api/hooks";

/** Shown while the backend does not answer; when it returns, every query reloads. */
export function ConnectionBanner() {
  const health = useHealth();
  const queryClient = useQueryClient();
  const wasDown = useRef(false);

  useEffect(() => {
    if (health.isError) wasDown.current = true;
    else if (health.isSuccess && wasDown.current) {
      wasDown.current = false;
      void queryClient.invalidateQueries();
    }
  }, [health.isError, health.isSuccess, queryClient]);

  if (!health.isError) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900">
      <span className="font-medium">Cannot reach the backend.</span>
      <span>Start it with <code className="rounded bg-surface px-1">make dev</code>; this page keeps retrying and recovers by itself.</span>
      <button type="button" onClick={() => void health.refetch()} className="rounded-full border border-red-300 bg-surface px-3 py-0.5 text-xs font-medium">
        Retry now
      </button>
    </div>
  );
}
