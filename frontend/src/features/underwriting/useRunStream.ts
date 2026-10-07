import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { subscribeToRun, type StreamState } from "../../api/client";
import { TERMINAL_EVENTS, type RunEvent } from "../../api/types";
import { applyEvent, initialStream, type RunStream } from "./reduceEvents";

type Action = { type: "event"; event: RunEvent } | { type: "connection"; state: StreamState };

function reducer(state: RunStream, action: Action): RunStream {
  return action.type === "event"
    ? applyEvent(state, action.event)
    : { ...state, connection: action.state };
}

/** Live state of one run. Mount it with key={runId}: a different run is a new component. */
export function useRunStream(runId: string | undefined, attempt = 0): RunStream {
  const [state, dispatch] = useReducer(reducer, initialStream);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!runId) return;
    // per-node details (sources, durations) refresh at most every 1.5 s while a run progresses
    let refresh: number | undefined;
    const unsubscribe = subscribeToRun(
      runId,
      (event) => {
        dispatch({ type: "event", event });
        if ((event.type === "node.completed" || event.type === "node.reused") && refresh === undefined) {
          refresh = window.setTimeout(() => {
            refresh = undefined;
            void queryClient.invalidateQueries({ queryKey: ["run", runId] });
          }, 1500);
        }
        if (TERMINAL_EVENTS.has(event.type)) {
          for (const key of ["run", "report", "runs", "diff"]) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
      },
      (connection) => dispatch({ type: "connection", state: connection }),
    );
    return () => {
      window.clearTimeout(refresh);
      unsubscribe();
    };
  }, [runId, attempt, queryClient]);

  return state;
}
