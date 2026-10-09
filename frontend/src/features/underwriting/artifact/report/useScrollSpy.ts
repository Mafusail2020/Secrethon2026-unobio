import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

function scrollParent(el: HTMLElement | null): HTMLElement | undefined {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if (overflow === "auto" || overflow === "scroll") return p;
  }
  return undefined;
}

/**
 * The listed element the reader is on: the last one whose top is above a line just under the sticky header, or the
 * last of all once the reader is at the bottom (the end of a page is too short to carry it up to the line).
 * `select` pins a choice (a clicked chip whose section cannot reach the line) until the reader scrolls.
 */
export function useScrollSpy(idsKey: string, header: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState<string | undefined>();
  const pinned = useRef<string | undefined>(undefined);

  useEffect(() => {
    const ids = idsKey.split("|").filter(Boolean);
    const container = scrollParent(document.getElementById(ids[0] ?? ""));
    if (!container) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (pinned.current) return setActive(pinned.current);
      const line = container.getBoundingClientRect().top + (header.current?.offsetHeight ?? 0) + 16;
      let current = ids[0];
      const atBottom = container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      if (atBottom) return setActive(ids.findLast((id) => document.getElementById(id)) ?? current);
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top > line) break;
        current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const release = () => {
      pinned.current = undefined;
      schedule();
    };
    const byHand = ["wheel", "touchmove", "keydown"] as const;
    container.addEventListener("scroll", schedule, { passive: true });
    byHand.forEach((type) => container.addEventListener(type, release, { passive: true }));
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      byHand.forEach((type) => container.removeEventListener(type, release));
    };
  }, [idsKey, header]);

  const select = useCallback((id: string) => {
    pinned.current = id;
    setActive(id);
  }, []);

  return { active, select };
}
