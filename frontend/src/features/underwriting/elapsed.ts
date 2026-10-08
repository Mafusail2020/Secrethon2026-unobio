import { formatDuration } from "../../lib/format";
import type { RunStream } from "./reduceEvents";

/** How long the run has been going (live) or took (finished); undefined until there is something to say. */
export function runElapsed(stream: RunStream, now: number): string | undefined {
  const first = stream.events[0];
  if (!first) return undefined;
  const start = new Date(first.ts).getTime();
  if (stream.status === "running" || stream.status === "queued") {
    return now > start ? formatDuration(now - start) : undefined;
  }
  const end = stream.events.at(-1);
  const reported = end?.type === "run.completed" ? Number((end.data as Record<string, unknown>).duration_s) : NaN;
  const ms = Number.isFinite(reported) ? reported * 1000 : end ? new Date(end.ts).getTime() - start : 0;
  return ms > 0 ? formatDuration(ms) : undefined;
}
