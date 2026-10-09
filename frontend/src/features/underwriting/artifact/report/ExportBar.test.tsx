import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../api/types";
import { ExportBar } from "./ExportBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const report = reportJson as unknown as UnderwritingReport;

function openMenu() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <MemoryRouter>
        <ExportBar report={report} />
      </MemoryRouter>,
    ),
  );
  act(() => host.querySelector("button")!.click());
  const entry = [...host.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes("Full report (PDF)"))!;
  return { entry, unmount: () => act(() => root.unmount()) };
}

afterEach(() => vi.unstubAllEnvs());

describe("the full report export", () => {
  it("is a download of the PDF the backend builds, not the browser's print dialog", () => {
    vi.stubEnv("VITE_API_MODE", "live");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { entry, unmount } = openMenu();
    expect(entry.tagName).toBe("A");
    expect(entry.getAttribute("href")).toBe(`/api/runs/${report.run_id}/report.pdf`);
    expect(entry.hasAttribute("download")).toBe(true);
    // jsdom cannot follow a download link
    document.addEventListener("click", (e) => e.preventDefault(), { once: true });
    act(() => (entry as HTMLElement).click());
    expect(print).not.toHaveBeenCalled();
    unmount();
    print.mockRestore();
  });

  it("falls back to printing in the mock, which has no backend to build the file", () => {
    vi.stubEnv("VITE_API_MODE", "mock");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { entry, unmount } = openMenu();
    expect(entry.tagName).toBe("BUTTON");
    act(() => (entry as HTMLElement).click());
    expect(print).toHaveBeenCalledOnce();
    unmount();
    print.mockRestore();
  });
});
