import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = "## Verdict\n\nConditional at low confidence.\n\n- one\n- two";

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const draw = (onOpenClaim: (id: string) => void) =>
    act(() => root.render(<MarkdownText text={TEXT} ids={[]} report={undefined} onOpenClaim={onOpenClaim} />));
  return { host, draw, unmount: () => act(() => root.unmount()) };
}

describe("MarkdownText", () => {
  it("keeps the same elements when its parent renders again, so nothing replays its entrance", () => {
    const { host, draw, unmount } = mount();
    draw(() => {});
    const before = [host.querySelector("h2"), host.querySelector("p"), host.querySelector("ul"), host.querySelector("li")];
    expect(before.every(Boolean)).toBe(true);
    // a drag re-renders the thread on every pointer move, each time with a new callback
    for (let i = 0; i < 5; i++) draw(() => {});
    const after = [host.querySelector("h2"), host.querySelector("p"), host.querySelector("ul"), host.querySelector("li")];
    after.forEach((node, i) => expect(node, ["h2", "p", "ul", "li"][i]).toBe(before[i]));
    unmount();
  });

  it("still opens a claim from its citation after a re-render", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const opened: string[] = [];
    const draw = (onOpenClaim: (id: string) => void) =>
      act(() => root.render(<MarkdownText text="Because [[c1]]." ids={["c1"]} report={undefined} onOpenClaim={onOpenClaim} />));
    draw(() => {});
    draw((id) => opened.push(id));
    host.querySelector("sup button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(opened).toEqual(["c1"]);
    act(() => root.unmount());
  });
});
