import type { DataRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crossesHome, installPortalTransition, revealOrigin } from "./portalTransition";

describe("revealOrigin", () => {
  it("grows from the clicked spot to the farthest corner, so the whole screen is covered", () => {
    expect(revealOrigin({ x: 1300, y: 20 }, { width: 1440, height: 860 })).toEqual({ x: 1300, y: 20, radius: Math.ceil(Math.hypot(1300, 840)) });
    expect(revealOrigin({ x: 0, y: 0 }, { width: 300, height: 400 }).radius).toBe(500);
  });

  it("keeps a point outside the screen on the screen", () => {
    expect(revealOrigin({ x: -50, y: 9999 }, { width: 100, height: 100 })).toMatchObject({ x: 0, y: 100 });
  });
});

describe("crossesHome", () => {
  it("is true between the home page and the workspace, in both directions", () => {
    expect(crossesHome("/", "/underwriting")).toBe(true);
    expect(crossesHome("/", "/underwriting/runs/run_1")).toBe(true);
    expect(crossesHome("/underwriting/runs/run_1", "/")).toBe(true);
  });

  it("is false for moves inside the workspace, and for anywhere else", () => {
    expect(crossesHome("/underwriting", "/underwriting/runs/run_1")).toBe(false);
    expect(crossesHome("/underwriting/runs/a", "/underwriting/runs/b")).toBe(false);
    expect(crossesHome("/", "/lab/glyph-field")).toBe(false);
    expect(crossesHome("/", "/")).toBe(false);
  });
});

describe("installPortalTransition", () => {
  const root = document.documentElement;
  let navigate: ReturnType<typeof vi.fn>;
  let router: DataRouter;

  const setup = (pathname: string) => {
    navigate = vi.fn(async () => {});
    router = { state: { location: { pathname } }, navigate } as unknown as DataRouter;
    installPortalTransition(router);
  };
  const click = (x: number, y: number, detail = 1, target: EventTarget = document.body) =>
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y, detail }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("innerWidth", 1440);
    vi.stubGlobal("innerHeight", 860);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    (document as { startViewTransition?: unknown }).startViewTransition = () => ({});
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    delete root.dataset.portal;
  });

  it("asks for a view transition from the home page to the workspace, opening where the click was", async () => {
    setup("/");
    click(1300, 20);
    await router.navigate("/underwriting");
    expect(navigate).toHaveBeenCalledWith("/underwriting", { viewTransition: true });
    expect(root.dataset.portal).toBeDefined();
    expect(root.style.getPropertyValue("--portal-x")).toBe("1300px");
    expect(root.style.getPropertyValue("--portal-y")).toBe("20px");
    expect(Number.parseInt(root.style.getPropertyValue("--portal-r"))).toBe(Math.ceil(Math.hypot(1300, 840)));
  });

  it("keeps the flag until the transition is over, and no longer than a few seconds", async () => {
    setup("/underwriting");
    click(40, 30);
    await router.navigate("/");
    vi.advanceTimersByTime(3000);
    expect(root.dataset.portal).toBeDefined();
    vi.advanceTimersByTime(4000);
    expect(root.dataset.portal).toBeUndefined();
    expect(root.style.getPropertyValue("--portal-x")).toBe("");
  });

  it("opens from the middle of the link when it was activated by the keyboard", async () => {
    setup("/");
    const link = document.createElement("a");
    link.getBoundingClientRect = () => ({ left: 1200, top: 10, width: 100, height: 40 }) as DOMRect;
    document.body.append(link);
    click(0, 0, 0, link);
    await router.navigate("/underwriting");
    expect(root.style.getPropertyValue("--portal-x")).toBe("1250px");
    expect(root.style.getPropertyValue("--portal-y")).toBe("30px");
    link.remove();
  });

  it("leaves every other move alone", async () => {
    setup("/underwriting");
    await router.navigate("/underwriting/runs/run_1", { replace: true });
    expect(navigate).toHaveBeenCalledWith("/underwriting/runs/run_1", { replace: true });
    expect(root.dataset.portal).toBeUndefined();
    await router.navigate(-1);
    expect(navigate).toHaveBeenLastCalledWith(-1, undefined);
  });

  it("does nothing for a reader who asks for less motion, or where the browser has no view transitions", async () => {
    setup("/");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await router.navigate("/underwriting");
    expect(navigate).toHaveBeenLastCalledWith("/underwriting", undefined);
    expect(root.dataset.portal).toBeUndefined();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    await router.navigate("/underwriting");
    expect(navigate).toHaveBeenLastCalledWith("/underwriting", undefined);
    expect(root.dataset.portal).toBeUndefined();
  });

  it("works out where an object target points", async () => {
    setup("/");
    await router.navigate({ pathname: "/underwriting/runs/r" });
    expect(navigate).toHaveBeenCalledWith({ pathname: "/underwriting/runs/r" }, { viewTransition: true });
  });
});
