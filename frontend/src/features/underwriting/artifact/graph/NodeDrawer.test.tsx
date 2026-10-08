import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import graphSpecJson from "../../../../../../contracts/fixtures/graph_spec.json";
import type { GraphSpec, NodeSpec, RunSummary } from "../../../../api/types";
import { CorrectionForm } from "../../correction/CorrectionForm";
import { initialStream } from "../../reduceEvents";
import { NodeDrawer } from "./NodeDrawer";

const spec = graphSpecJson as GraphSpec;
const byId = (id: string): NodeSpec => spec.nodes.find((n) => n.id === id)!;
const html = (node: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
const run = (status: RunSummary["status"]) => ({ id: "r1", status }) as unknown as RunSummary;

const drawer = (node: NodeSpec, r: RunSummary | undefined, tab: "overview" | "correct" = "overview") =>
  html(<NodeDrawer run={r} node={node} graph={spec} stream={initialStream} report={undefined} canCorrect={false} tab={tab} onTab={() => {}} onClose={() => {}} />);

describe("node drawer", () => {
  it("offers overview, output, log and correct for a step, with its purpose and state keys", () => {
    const markup = drawer(byId("verdict"), run("completed"));
    for (const tab of ["Overview", "Output", "Log", "Correct"]) expect(markup).toContain(tab);
    expect(markup).toContain(byId("verdict").description);
    expect(markup).toContain("ledger");
    expect(markup).toContain("critical");
  });

  it("shows a container's inner steps and only the tabs that make sense for it", () => {
    const markup = drawer(byId("bull_case"), run("completed"));
    expect(markup).toContain("Inner steps");
    expect(markup).toContain("Bull claim gate");
    expect(markup).not.toContain(">Output<");
  });

  it("says what to do when there is no run yet", () => {
    expect(drawer(byId("verdict"), undefined)).toContain("Run an underwriting to see how this step performs.");
  });

  it("explains why corrections are unavailable on a failed or running run", () => {
    expect(drawer(byId("verdict"), run("failed"), "correct")).toContain("This run failed, so it cannot be corrected");
    expect(drawer(byId("verdict"), run("running"), "correct")).toContain("This run is still going");
  });
});

describe("correction form", () => {
  const form = (props: Partial<Parameters<typeof CorrectionForm>[0]>) =>
    html(<CorrectionForm runId="r1" node={byId("verdict")} graph={spec} report={undefined} canCorrect {...props} />);

  it("previews how much would recompute", () => {
    expect(form({})).toContain("Recomputes 2 of 23 steps (verdict, report assembler)");
  });

  it("pre-fills the text and explains a rerouted node", () => {
    const markup = form({ initialText: "I disagree with this claim", note: "gate only re-checks drafts" });
    expect(markup).toContain("I disagree with this claim");
    expect(markup).toContain("gate only re-checks drafts");
  });

  it("disables submitting and says why when corrections are not open", () => {
    const markup = form({ canCorrect: false });
    expect(markup).toContain("Corrections open once this run has completed.");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>.*Re-run with correction/s);
  });

  it("refuses a node that cannot be corrected", () => {
    expect(form({ node: byId("report_assembler") })).toContain("cannot be corrected directly");
  });
});
