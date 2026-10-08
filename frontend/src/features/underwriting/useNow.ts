import { useEffect, useState } from "react";

/** A clock that ticks once a second while `active`; 0 until the first tick. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const frame = requestAnimationFrame(tick);
    const timer = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [active]);
  return now;
}
