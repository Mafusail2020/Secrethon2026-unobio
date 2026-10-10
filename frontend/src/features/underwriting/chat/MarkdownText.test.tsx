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

  it("draws a chat reply as Markdown: bold, lists, code, a table and a task list, with raw HTML shown as text", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const text = [
      "It is **conditional** because of *two* things:",
      "",
      "1. the trials stopped",
      "2. the target has a liability",
      "",
      "- [x] checked the report",
      "- [ ] not checked the file",
      "",
      "Use `LRRK2` here.",
      "",
      "```",
      "plain block",
      "```",
      "",
      "| Case | PoS |",
      "|---|---|",
      "| BACE1 | 4% |",
      "",
      "<b>not html</b>",
    ].join("\n");
    act(() => root.render(<MarkdownText text={text} ids={[]} variant="answer" report={undefined} onOpenClaim={() => {}} />));
    expect(host.querySelector("strong")?.textContent).toBe("conditional");
    expect(host.querySelector("em")?.textContent).toBe("two");
    expect(host.querySelectorAll("ol li")).toHaveLength(2);
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    expect(host.querySelector("p code")?.textContent).toBe("LRRK2");
    expect(host.querySelector("pre")?.textContent).toContain("plain block");
    expect(host.querySelector("table th")?.textContent).toBe("Case");
    expect(host.querySelector("table td")?.textContent).toBe("BACE1");
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("<b>not html</b>");
    act(() => root.unmount());
  });

  it("draws headings the way Obsidian does: every level a step smaller than the one above, with no bar and no tiny label", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const text = ["# One", "## Two", "### Three", "#### Four", "##### Five", "###### Six"].join("\n\n");
    const sizes = (variant: "briefing" | "answer") => {
      act(() => root.render(<MarkdownText text={text} ids={[]} variant={variant} report={undefined} onOpenClaim={() => {}} />));
      return [...host.querySelectorAll("h2,h3,h4,h5,h6")].map((h) => {
        expect(h.className).not.toMatch(/border-l|uppercase|tracking-wider/);
        return Number(/text-\[([\d.]+)em\]/.exec(h.className)?.[1] ?? 1);
      });
    };
    const doc = sizes("briefing");
    expect(doc).toEqual([2, 1.6, 1.37, 1.25, 1.12, 1]);
    const reply = sizes("answer");
    expect(reply.slice(0, 4)).toEqual([1.5, 1.3, 1.15, 1.05]);
    for (const steps of [doc, reply]) for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThanOrEqual(steps[i - 1]!);
    act(() => root.unmount());
  });

  it("draws a quote with a bar and a table with a border round every cell", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<MarkdownText text={"> quoted\n\n| A | B |\n|---|--:|\n| 1 | 2 |"} ids={[]} report={undefined} onOpenClaim={() => {}} />));
    expect(host.querySelector("blockquote")?.className).toContain("border-l-[3px]");
    expect(host.querySelector("blockquote")?.className).not.toContain("bg-");
    expect(host.querySelector("th")?.className).toContain("border");
    expect(host.querySelector("td")?.className).toContain("border");
    expect((host.querySelectorAll("td")[1] as HTMLElement).style.textAlign).toBe("right");
    act(() => root.unmount());
  });
});
