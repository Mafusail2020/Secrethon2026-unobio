import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import eventsRaw from "../../../../../contracts/fixtures/events_bace1_alzheimers.jsonl?raw";
import graphSpecJson from "../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec, RunEvent, RunSummary } from "../../../api/types";
import { applyEvent, initialStream } from "../reduceEvents";
import { Composer } from "./Composer";
import { ExampleCards } from "./ExampleCards";
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

  it("starts from an example", () => {
    const markup = html(<Composer initial={{ indication: "Hypercholesterolemia", mechanism: "PCSK9 inhibition" }} />);
    expect(markup).toContain('value="PCSK9 inhibition"');
  });
});

describe("example cards", () => {
  it("lists the examples with their hints", () => {
    const markup = html(<ExampleCards onPick={() => {}} />);
    expect(markup).toContain("BACE1 inhibition for Alzheimer&#x27;s disease");
    expect(markup).toContain("Expected: strong human genetics");
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
});
