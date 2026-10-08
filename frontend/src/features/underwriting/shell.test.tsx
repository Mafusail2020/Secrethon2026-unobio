import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { RunSummary } from "../../api/types";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

const run = (id: string, parent: string | null, at: string, extra: Partial<RunSummary> = {}) =>
  ({
    id,
    status: "completed",
    program: { indication: "Alzheimer's disease", mechanism: "BACE1 inhibition", links: [] },
    options: { effort: "medium" },
    created_at: at,
    parent_run_id: parent,
    decision: "conditional",
    error: null,
    ...extra,
  }) as unknown as RunSummary;

function sidebar(runs: RunSummary[], currentId?: string) {
  const client = new QueryClient();
  client.setQueryData(["runs"], runs);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Sidebar currentId={currentId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bar = (props: Partial<Parameters<typeof TopBar>[0]> = {}) =>
  renderToStaticMarkup(
    <TopBar title="New underwriting" decision={undefined} hasRun={false} panel={null} onTogglePanel={() => {}} sidebarOpen onToggleSidebar={() => {}} {...props} />,
  );

describe("top bar", () => {
  it("offers the graph before a run exists and keeps the run-only views disabled", () => {
    const markup = bar();
    const button = (label: string) => markup.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))![0];
    expect(button("Graph")).not.toContain('disabled=""');
    for (const label of ["Report", "Sources", "Logs"]) expect(button(label)).toContain('disabled=""');
  });

  it("marks the open view as pressed and shows the decision once there is one", () => {
    const markup = bar({ hasRun: true, panel: "graph", decision: "do_not_invest", title: "A · B" });
    expect(markup.match(/<button[^>]*aria-label="Graph"[^>]*>/)![0]).toContain('aria-pressed="true"');
    expect(markup.match(/<button[^>]*aria-label="Report"[^>]*>/)![0]).toContain('aria-pressed="false"');
    expect(markup).toContain("Do not invest");
    expect(markup).toContain("A · B");
  });
});

describe("sidebar", () => {
  it("lists a run and its corrected versions as one entry with version links", () => {
    const markup = sidebar(
      [run("r1", null, "2026-10-05T10:00:00Z"), run("r2", "r1", "2026-10-05T11:00:00Z"), run("r3", null, "2026-10-04T10:00:00Z", { program: { indication: "Hypercholesterolemia", mechanism: "PCSK9 inhibition", links: [] } } as never)],
      "r2",
    );
    expect(markup.match(/Alzheimer&#x27;s disease/g)).toHaveLength(1);
    expect(markup).toContain("Hypercholesterolemia");
    expect(markup).toContain('href="/underwriting/runs/r2"'); // the entry opens the newest version
    expect(markup).toContain(">v1<");
    expect(markup).toContain(">v2<");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("New underwriting");
  });

  it("says so when there is nothing yet", () => {
    expect(sidebar([])).toContain("Nothing yet");
  });
});
