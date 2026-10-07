import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../api/types";
import { runElapsed } from "./elapsed";
import { applyEvent, initialStream } from "./reduceEvents";

const ev = (seq: number, type: RunEvent["type"], ts: string, data: Record<string, unknown> = {}): RunEvent => ({ seq, run_id: "r", ts, type, node_id: null, data });

describe("runElapsed", () => {
  const started = ev(1, "run.started", "2026-01-01T00:00:00Z");

  it("has nothing to say before the first event or the first tick", () => {
    expect(runElapsed(initialStream, 0)).toBeUndefined();
    expect(runElapsed(applyEvent(initialStream, started), 0)).toBeUndefined();
  });

  it("counts up while the run is going", () => {
    const running = applyEvent(initialStream, started);
    expect(runElapsed(running, new Date("2026-01-01T00:01:24Z").getTime())).toBe("1m 24s");
    expect(runElapsed(running, new Date("2026-01-01T00:00:03.5Z").getTime())).toBe("3.5s");
  });

  it("reports the duration the server measured once it is over", () => {
    const done = [started, ev(2, "run.completed", "2026-01-01T00:00:09Z", { duration_s: 8.4 })].reduce(applyEvent, initialStream);
    expect(runElapsed(done, 0)).toBe("8.4s");
  });

  it("falls back to the event timestamps when the server gave no duration", () => {
    const failed = [started, ev(2, "run.failed", "2026-01-01T00:00:05Z", { error: "x" })].reduce(applyEvent, initialStream);
    expect(runElapsed(failed, 0)).toBe("5.0s");
  });
});
