import { useEffect, useRef } from "react";
import { HomeSections } from "./HomeSections";

const ROOT = "home-module__7XBcjq__root";
const REVEAL = "home-module__7XBcjq__reveal";
const REVEAL_IN = "home-module__7XBcjq__revealIn";
const HERO_BG = "home-module__7XBcjq__heroBg";

/** The unobio.com home page: copied markup and CSS plus its two scroll behaviours. */
export function Home() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const show = (el: Element) => el.classList.add(REVEAL_IN);
    const pending = root.querySelectorAll(`.${REVEAL}:not(.${REVEAL_IN})`);
    if (typeof IntersectionObserver === "undefined") {
      pending.forEach(show);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            show(entry.target);
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.15 },
    );
    pending.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const background = ref.current?.querySelector<HTMLElement>(`.${HERO_BG}`);
    if (!background) return;
    const onScroll = () => {
      background.style.transform = `translateY(${window.scrollY * 0.35}px)`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="min-h-screen">
      <div ref={ref} className={ROOT}>
        <HomeSections />
      </div>
    </main>
  );
}
