import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentDrop } from "./DocumentDrop";
import { useDocuments } from "./useDocuments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Docs = ReturnType<typeof useDocuments>;

function mount() {
  const seen: { current: Docs | undefined } = { current: undefined };
  function Probe() {
    seen.current = useDocuments();
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Probe />));
  return { get: () => seen.current!, unmount: () => act(() => root.unmount()) };
}

const reply = (name: string, status = 201) =>
  status === 201
    ? new Response(JSON.stringify({ id: `doc_${[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(16, "0")}`, name, kind: "text", size_bytes: 5 }), { status })
    : new Response(JSON.stringify({ error: { code: "unsupported_document", message: "only PDF, TXT and MD files are accepted", details: [] } }), { status });

afterEach(() => vi.unstubAllGlobals());

describe("useDocuments", () => {
  it("uploads each file as the raw body with its name in a header, and holds what the server returns", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => reply(decodeURIComponent((init.headers as Record<string, string>)["X-File-Name"]!)));
    vi.stubGlobal("fetch", fetchMock);
    const hook = mount();
    await act(() => hook.get().add([new File(["hello"], "Mouse study (v2).txt", { type: "text/plain" })]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/documents");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-File-Name"]).toBe(encodeURIComponent("Mouse study (v2).txt"));
    expect(hook.get().documents.map((d) => d.name)).toEqual(["Mouse study (v2).txt"]);
    expect(hook.get().uploading).toEqual([]);
    hook.unmount();
  });

  it("refuses a bad file without calling the server, and says why", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hook = mount();
    await act(() => hook.get().add([new File(["x"], "slides.pptx")]));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.get().documents).toEqual([]);
    expect(hook.get().problems[0]).toMatch(/slides\.pptx: only PDF, TXT and MD/);
    hook.unmount();
  });

  it("reports a server refusal against the file and does not keep it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply("x", 415)));
    const hook = mount();
    await act(() => hook.get().add([new File(["x"], "odd.txt")]));
    expect(hook.get().documents).toEqual([]);
    expect(hook.get().problems[0]).toContain("odd.txt: ");
    // the name is free again, so the same file can be tried once more
    vi.stubGlobal("fetch", vi.fn(async () => reply("odd.txt")));
    await act(() => hook.get().add([new File(["x"], "odd.txt")]));
    expect(hook.get().documents.map((d) => d.name)).toEqual(["odd.txt"]);
    hook.unmount();
  });

  it("does not hold the same content twice under two names", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "doc_0123456789abcdef", name: "first.txt", kind: "text", size_bytes: 5 }), { status: 201 })));
    const hook = mount();
    await act(() => hook.get().add([new File(["same"], "first.txt")]));
    await act(() => hook.get().add([new File(["same"], "copy.txt")]));
    expect(hook.get().documents).toHaveLength(1);
    expect(hook.get().problems).toEqual(["copy.txt has the same content as a file already added."]);
    hook.unmount();
  });

  it("drops a file when it is removed, and frees its place", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => reply(decodeURIComponent((init.headers as Record<string, string>)["X-File-Name"]!))));
    const hook = mount();
    await act(() => hook.get().add([new File(["x"], "a.txt"), new File(["y"], "b.txt")]));
    expect(hook.get().documents).toHaveLength(2);
    act(() => hook.get().remove(hook.get().documents[0]!.id));
    expect(hook.get().documents.map((d) => d.name)).toEqual(["b.txt"]);
    await act(() => hook.get().add([new File(["x"], "a.txt")]));
    expect(hook.get().documents.map((d) => d.name)).toEqual(["b.txt", "a.txt"]);
    hook.unmount();
  });
});

describe("DocumentDrop", () => {
  const doc = { id: "doc_0123456789abcdef", name: "BACE1 preclinical.pdf", kind: "pdf" as const, size_bytes: 2_450_000 };

  it("says what it takes and lists what is attached, each with a way to remove it", () => {
    const markup = renderToStaticMarkup(<DocumentDrop documents={[doc]} uploading={["new.txt"]} problems={["big.pdf is over 10 MB."]} onAdd={() => {}} onRemove={() => {}} />);
    expect(markup).toContain("Drop PDF, text or markdown files here");
    expect(markup).toContain("BACE1 preclinical.pdf");
    expect(markup).toContain("2.5 MB");
    expect(markup).toContain('aria-label="Remove BACE1 preclinical.pdf"');
    expect(markup).toContain("Uploading");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('accept=".pdf,.txt,.md"');
  });

  it("shows no list when nothing is attached", () => {
    expect(renderToStaticMarkup(<DocumentDrop documents={[]} uploading={[]} problems={[]} onAdd={() => {}} onRemove={() => {}} />)).not.toContain("Attached documents");
  });
});
