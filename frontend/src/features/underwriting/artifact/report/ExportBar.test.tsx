import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import type { UnderwritingReport } from "../../../../api/types";
import { saveFile } from "./deck/deckPdf";
import { ExportBar } from "./ExportBar";
import { createReportPdf } from "./reportPdf";

vi.mock("./reportPdf", () => ({ createReportPdf: vi.fn(async () => new Blob(["%PDF"])) }));
vi.mock("./deck/deckPdf", () => ({ saveFile: vi.fn() }));

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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(createReportPdf).mockClear();
  vi.mocked(saveFile).mockClear();
});

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

  it("makes a plain PDF in the browser in the mock, which has no backend to build the formatted file", async () => {
    vi.stubEnv("VITE_API_MODE", "mock");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { entry, unmount } = openMenu();
    expect(entry.tagName).toBe("BUTTON");
    await act(async () => (entry as HTMLElement).click());
    expect(createReportPdf).toHaveBeenCalledWith(report);
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), `Unobio underwriting - ${report.program.mechanism} in ${report.program.indication}.pdf`);
    expect(print).not.toHaveBeenCalled();
    unmount();
    print.mockRestore();
  });

  it("prints instead when the browser cannot make even the plain file", async () => {
    vi.stubEnv("VITE_API_MODE", "mock");
    vi.mocked(createReportPdf).mockRejectedValueOnce(new Error("no"));
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { entry, unmount } = openMenu();
    await act(async () => (entry as HTMLElement).click());
    expect(saveFile).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledOnce();
    unmount();
    print.mockRestore();
  });
});
