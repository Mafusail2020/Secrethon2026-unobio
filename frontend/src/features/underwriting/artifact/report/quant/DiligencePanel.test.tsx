import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { DiligenceQuestion, UnderwritingReport } from "../../../../../api/types";
import { ReportContext, type ReportContextValue } from "../reportContext";
import { DiligencePanel } from "./DiligencePanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const context = { jumpToClaim: () => {} } as unknown as ReportContextValue;
const first = (reportJson as unknown as UnderwritingReport).diligence_questions[0]!;
const question = (priority: number): DiligenceQuestion => ({ ...first, priority });

afterEach(() => vi.restoreAllMocks());

describe("the lists of what we do not know", () => {
  it("show every line, even when a run says the same thing more than once", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    const root = createRoot(host);
    const same = "no key point is backed by a checked claim";
    act(() =>
      root.render(
        <ReportContext.Provider value={context}>
          <DiligencePanel unknowns={[same, same, same]} questions={[question(1), question(2)]} />
        </ReportContext.Provider>,
      ),
    );
    expect(host.querySelectorAll("ul li")).toHaveLength(3);
    expect(host.querySelectorAll("ol > li")).toHaveLength(2);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
    act(() => root.unmount());
  });
});
