import { useEffect, useState } from "react";

export interface TypedPart {
  text: string;
  /** milliseconds per character */
  speed: number;
}

/** How many characters of each part have been typed `elapsed` ms after the start; a part begins when the one before it ends, after `pause`. */
export function typedCounts(elapsed: number, parts: TypedPart[], pause: number): number[] {
  let at = 0;
  return parts.map((part, i) => {
    if (i > 0 && part.speed !== parts[i - 1]!.speed) at += pause;
    const length = Math.floor(Math.max(0, elapsed - at) / part.speed);
    at += part.text.length * part.speed;
    return Math.min(part.text.length, length);
  });
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Types the parts out one after another, `delay` ms after the component appears. Reduced motion shows them whole. */
export function useTypewriter(parts: TypedPart[], pause = 280, delay = 0): { counts: number[]; done: boolean } {
  const [counts, setCounts] = useState<number[]>(() => (reducedMotion() ? parts.map((p) => p.text.length) : parts.map(() => 0)));
  const key = parts.map((p) => `${p.speed}:${p.text}`).join("|");

  useEffect(() => {
    if (reducedMotion()) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const next = typedCounts(now - start - delay, parts, pause);
      setCounts((prev) => (prev.length === next.length && prev.every((n, i) => n === next[i]) ? prev : next));
      if (next.some((n, i) => n < parts[i]!.text.length)) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `key` stands for the parts: a new array with the same text must not restart the typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pause, delay]);

  return { counts, done: counts.every((n, i) => n >= parts[i]!.text.length) };
}
