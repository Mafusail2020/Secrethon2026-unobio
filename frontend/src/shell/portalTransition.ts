import type { DataRouter } from "react-router-dom";

/** Where the new page opens from, and how far it has to grow to cover the screen. */
export function revealOrigin(point: { x: number; y: number }, viewport: { width: number; height: number }) {
  const x = Math.min(Math.max(point.x, 0), viewport.width);
  const y = Math.min(Math.max(point.y, 0), viewport.height);
  return { x, y, radius: Math.ceil(Math.hypot(Math.max(x, viewport.width - x), Math.max(y, viewport.height - y))) };
}

const isWorkspace = (pathname: string) => pathname === "/underwriting" || pathname.startsWith("/underwriting/");

/** Between the home page and the workspace, in either direction. Moves inside either one stay as they are. */
export function crossesHome(from: string, to: string): boolean {
  return (from === "/") !== (to === "/") && (isWorkspace(from) || isWorkspace(to));
}

type Target = Parameters<DataRouter["navigate"]>[0];

function pathOf(to: Target, base: string): string {
  if (typeof to === "number" || to == null) return base;
  if (typeof to === "string") return new URL(to, `https://x${base}`).pathname;
  return to.pathname ?? base;
}

const CLICK_FRESH_MS = 1500;
const POLL_MS = 150;
const GIVE_UP_MS = 6000;
let last: { x: number; y: number; at: number } | undefined;

const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const supported = () => typeof document.startViewTransition === "function";

/** A keyboard "click" has no position; its link's centre is where the reader's attention is. */
function remember(event: MouseEvent) {
  const el = event.target instanceof Element ? event.target.closest("a,button") : null;
  const box = el?.getBoundingClientRect();
  const keyboard = event.detail === 0 && box;
  last = { x: keyboard ? box.left + box.width / 2 : event.clientX, y: keyboard ? box.top + box.height / 2 : event.clientY, at: performance.now() };
}

const transitionRunning = () =>
  (document.getAnimations?.() ?? []).some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));

/** The flag has to outlast the whole transition, however slow the machine, and go as soon as it is over. */
function endWhenTransitionIsOver(root: HTMLElement) {
  const started = performance.now();
  let seen = false;
  const check = () => {
    seen ||= transitionRunning();
    const over = (seen && !transitionRunning()) || performance.now() - started > GIVE_UP_MS;
    if (!over) return void setTimeout(check, POLL_MS);
    delete root.dataset.portal;
    for (const name of ["--portal-x", "--portal-y", "--portal-r"]) root.style.removeProperty(name);
  };
  setTimeout(check, POLL_MS);
}

/**
 * Makes the step between the home page and the workspace a reveal: the workspace opens from the spot that was
 * clicked, over the page being left. It is the browser's View Transitions API through the router's own
 * `viewTransition` option; where that is missing, or the reader asks for less motion, nothing changes.
 * The page markup is not touched: the CSS (styles/transition.css) reads `data-portal` and three variables.
 */
export function installPortalTransition(router: DataRouter): void {
  if (typeof document === "undefined") return;
  document.addEventListener("click", remember, true);
  const navigate = router.navigate.bind(router);
  router.navigate = ((to: Target, options?: Parameters<DataRouter["navigate"]>[1]) => {
    if (typeof to === "number" || reduced() || !supported() || !crossesHome(router.state.location.pathname, pathOf(to, router.state.location.pathname))) {
      return navigate(to as never, options);
    }
    const fresh = last && performance.now() - last.at < CLICK_FRESH_MS ? last : undefined;
    const origin = revealOrigin(fresh ?? { x: innerWidth / 2, y: innerHeight / 2 }, { width: innerWidth, height: innerHeight });
    const root = document.documentElement;
    root.style.setProperty("--portal-x", `${origin.x}px`);
    root.style.setProperty("--portal-y", `${origin.y}px`);
    root.style.setProperty("--portal-r", `${origin.radius}px`);
    root.dataset.portal = "";
    endWhenTransitionIsOver(root);
    return navigate(to as never, { ...options, viewTransition: true });
  }) as DataRouter["navigate"];
}
