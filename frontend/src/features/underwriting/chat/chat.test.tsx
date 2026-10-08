import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../../contracts/fixtures/graph_spec.json";
import type { ChatMessage, GraphSpec, RunEvent, RunSummary } from "../../../api/types";
import { applyEvent, initialStream } from "../reduceEvents";
import { Composer } from "./Composer";
import { RunThread } from "./RunThread";

const html = (node: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

const spec = graphSpecJson as GraphSpec;
const events = eventsRaw
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as RunEvent);
const run = {
  id: "r1",
  status: "completed",
  program: { indication: "Alzheimer's disease", mechanism: "BACE1 inhibition", links: [] },
  options: { effort: "medium" },
  created_at: "2026-10-05T12:00:00Z",
  parent_run_id: null,
  decision: "conditional",
  error: null,
} as unknown as RunSummary;

describe("composer", () => {
  it("shows required fields, the four effort levels and a collapsed details area", () => {
    const markup = html(<Composer />);
    expect(markup).toContain("Indication");
    expect(markup).toContain("Mechanism or target");
    for (const label of ["Low", "Medium", "High", "Panel"]) expect(markup).toContain(label);
    expect(markup).toContain("Add details");
    expect(markup).toContain("Balanced default.");
    expect(markup).not.toContain("Panel size"); // only for panel effort
  });
});

describe("run thread", () => {
  const thread = (stream = events.reduce(applyEvent, initialStream)) =>
    html(
      <RunThread run={run} spec={spec} stream={stream} decision="conditional" report={undefined} onOpenReport={() => {}} onReconnect={() => {}} />,
    );

  it("groups steps into the eight pipeline phases and shows the verdict and usage", () => {
    const markup = thread();
    for (const label of ["Understand the program", "Gather public evidence", "Argue both sides", "Assemble the report"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("Conditional");
    expect(markup).toContain("Open report");
    expect(markup).toContain("stub data");
    expect(markup).toContain("model call");
  });

  it("shows a waiting run with every phase pending and no verdict", () => {
    const waiting = html(
      <RunThread run={run} spec={spec} stream={initialStream} decision={undefined} report={undefined} onOpenReport={() => {}} onReconnect={() => {}} />,
    );
    expect(waiting).toContain("Waiting for a free slot");
    expect(waiting).not.toContain("Open report");
  });

  it("offers a reconnect when the stream drops while the run is still going", () => {
    const dropped = { ...events.slice(0, 5).reduce(applyEvent, initialStream), connection: "closed" as const };
    const markup = html(<RunThread run={run} spec={spec} stream={dropped} decision={undefined} report={undefined} onOpenReport={() => {}} onReconnect={() => {}} />);
    expect(markup).toContain("Lost the live stream");
    expect(markup).toContain("Reconnect");
  });

  it("shows the failure, the failing step's reason and a way to run again", () => {
    const failed = [
      ...events.slice(0, 3),
      { seq: 99, run_id: "r", ts: "2026-10-05T12:00:30Z", type: "run.failed", node_id: null, data: { error: "planner could not parse the program" } } as RunEvent,
    ].reduce(applyEvent, initialStream);
    const markup = html(<RunThread run={{ ...run, status: "failed" } as RunSummary} spec={spec} stream={failed} decision={undefined} report={undefined} onOpenReport={() => {}} onReconnect={() => {}} />);
    expect(markup).toContain("The run failed");
    expect(markup).toContain("planner could not parse the program");
    expect(markup).toContain("Run again with the same input");
    expect(markup).not.toContain("Lost the live stream");
  });

  it("shows how long a finished run took", () => {
    expect(thread()).toMatch(/Analysis complete \(23 steps\) · \d/);
  });

  it("keeps the step list folded and shows only what is being worked on", () => {
    const running = html(
      <RunThread run={run} spec={spec} stream={events.slice(0, 3).reduce(applyEvent, initialStream)} decision={undefined} report={undefined} onOpenReport={() => {}} onReconnect={() => {}} />,
    );
    expect(running).toContain('aria-expanded="false"');
    expect(running).toMatch(/<div id="work-trace" hidden=""/);
    expect(running).toContain("Understand the program: Input resolver");
    expect(running).toContain("Show steps");
  });

  it("draws the summary as a Markdown briefing with numbered citations and a list of the claims cited", () => {
    const message = {
      role: "assistant",
      run_id: "r1",
      content: "## Verdict\n\n**Conditional** call [[c2]] and more [[c1]].\n\n- first risk [[c2]]\n- <b>not html</b>\n\n### Detail\n\nBody.",
      cited_claim_ids: ["c2", "c1"],
    } as ChatMessage;
    const markup = html(
      <RunThread run={run} spec={spec} stream={events.reduce(applyEvent, initialStream)} decision="conditional" report={undefined} summary={{ message, pending: false, failed: false, retry: () => {} }} onOpenReport={() => {}} onReconnect={() => {}} />,
    );
    expect(markup).toMatch(/<h2[^>]*>Verdict<\/h2>/);
    expect(markup).toMatch(/<h3[^>]*>Detail<\/h3>/);
    expect(markup).toContain("<strong");
    expect(markup).toMatch(/<li>first risk/);
    // c2 is cited first, so it is number 1; the marks themselves never show
    expect(markup).toMatch(/aria-label="Open claim 1"[^>]*>1<\/button>/);
    expect(markup).toMatch(/aria-label="Open claim 2"[^>]*>2<\/button>/);
    expect(markup).not.toContain("[[");
    expect(markup).toContain("Claims cited (2)");
    expect(markup).not.toContain("<b>"); // raw HTML from the model is shown as text, never rendered
  });

  it("says when the summary is being written or could not be", () => {
    const stream = events.reduce(applyEvent, initialStream);
    const view = (summary: { message: ChatMessage | undefined; pending: boolean; failed: boolean }) =>
      html(<RunThread run={run} spec={spec} stream={stream} decision="conditional" report={undefined} summary={{ ...summary, retry: () => {} }} onOpenReport={() => {}} onReconnect={() => {}} />);
    expect(view({ message: undefined, pending: true, failed: false })).toContain("Writing the summary");
    const failed = view({ message: undefined, pending: false, failed: true });
    expect(failed).toContain("Could not write the summary");
    expect(failed).toContain("Try again");
  });
});
