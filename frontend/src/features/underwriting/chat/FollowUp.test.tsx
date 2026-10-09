import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import reportJson from "../../../../../contracts/fixtures/report_bace1_alzheimers.json";
import { ApiError } from "../../../api/client";
import type { ChatMessage, UnderwritingReport } from "../../../api/types";
import { FollowUpInput, FollowUpMessages } from "./FollowUp";
import { useFollowUp } from "./useFollowUp";

const report = reportJson as unknown as UnderwritingReport;
const claimId = Object.keys(report.claims)[0];

const api = vi.hoisted(() => ({ getMessages: vi.fn(), postMessage: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  getApi: () => Promise.resolve(api),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

function Harness({ ready, onOpenClaim }: { ready: boolean; onOpenClaim: (id: string) => void }) {
  const follow = useFollowUp("r1", ready);
  return (
    <>
      <FollowUpMessages follow={follow} report={report} onOpenClaim={onOpenClaim} />
      <FollowUpInput follow={follow} ready={ready} />
    </>
  );
}

async function mount(ready = true, onOpenClaim = vi.fn()) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Harness ready={ready} onOpenClaim={onOpenClaim} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return onOpenClaim;
}

const box = () => host.querySelector("textarea") as HTMLTextAreaElement;

async function ask(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(), text);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await flush();
}

beforeEach(() => {
  api.getMessages.mockReset().mockResolvedValue([]);
  api.postMessage.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("follow-up chat", () => {
  it("shows earlier questions with their cited claims and opens a claim on click", async () => {
    const earlier: ChatMessage[] = [
      { role: "user", content: "Why conditional?", run_id: "r1", cited_claim_ids: [], cited_evidence_ids: [] },
      { role: "assistant", content: "Because of the trials.", run_id: "r1", cited_claim_ids: [claimId], cited_evidence_ids: [] },
    ];
    api.getMessages.mockResolvedValue(earlier);
    const onOpenClaim = await mount();
    expect(host.textContent).toContain("Why conditional?");
    expect(host.textContent).toContain("Because of the trials.");
    await act(async () => (host.querySelector("li li button") as HTMLButtonElement).click());
    expect(onOpenClaim).toHaveBeenCalledWith(claimId);
  });

  it("sends a question and appends the reply to the thread", async () => {
    api.postMessage.mockResolvedValue({ role: "assistant", content: "Grounded answer.", run_id: "r1", cited_claim_ids: [claimId], cited_evidence_ids: [] });
    await mount();
    await ask("  What about safety?  ");
    expect(api.postMessage).toHaveBeenCalledWith("r1", expect.objectContaining({ role: "user", content: "What about safety?" }));
    expect(host.textContent).toContain("What about safety?");
    expect(host.textContent).toContain("Grounded answer.");
    expect(box().value).toBe("");
  });

  it("sends on Enter and keeps Shift+Enter for a new line", async () => {
    api.postMessage.mockResolvedValue({ role: "assistant", content: "ok", run_id: "r1", cited_claim_ids: [], cited_evidence_ids: [] });
    await mount();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box(), "line one");
      box().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })));
    expect(api.postMessage).not.toHaveBeenCalled();
    await act(async () => void box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await flush();
    expect(api.postMessage).toHaveBeenCalledTimes(1);
  });

  it("stays closed, and says why, until the analysis is complete", async () => {
    await mount(false);
    expect(box().disabled).toBe(true);
    expect(box().placeholder).toContain("open when the analysis completes");
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("locks the input with a clear note when the question limit is reached", async () => {
    api.postMessage.mockRejectedValue(new ApiError(429, "chat_limit", "limit"));
    await mount();
    await ask("one more");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("question limit");
    expect(box().disabled).toBe(true);
  });

  it("shows other errors without locking the input", async () => {
    api.postMessage.mockRejectedValue(new ApiError(502, "chat_failed", "the model's answer could not be read; try again"));
    await mount();
    await ask("hello");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("try again");
    expect(box().disabled).toBe(false);
  });
});
