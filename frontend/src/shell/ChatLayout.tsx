import { Outlet } from "react-router-dom";

/** Fills the viewport under the fixed header. overflow-clip, not hidden: scrollIntoView scrolls a hidden box and slides the workspace under the header. */
export function ChatLayout() {
  return (
    <main className="relative box-border h-dvh min-h-[560px] overflow-clip bg-canvas pt-14">
      <Outlet />
    </main>
  );
}
