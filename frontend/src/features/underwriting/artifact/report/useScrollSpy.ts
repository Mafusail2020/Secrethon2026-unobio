import { useEffect, useState } from "react";

/** The id of the first listed element inside the reading band near the top of the scroll area. */
export function useScrollSpy(idsKey: string): string | undefined {
  const [active, setActive] = useState<string | undefined>();
  useEffect(() => {
    const ids = idsKey.split("|").filter(Boolean);
    const elements = ids.flatMap((id) => {
      const el = document.getElementById(id);
      return el ? [el] : [];
    });
    if (!elements.length || typeof IntersectionObserver === "undefined") return;
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        setActive(ids.find((id) => inBand.has(id)));
      },
      { rootMargin: "-130px 0px -55% 0px" },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [idsKey]);
  return active;
}
