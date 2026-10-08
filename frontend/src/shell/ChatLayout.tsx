import { Outlet } from "react-router-dom";

/** Fills the viewport under the fixed header; the thread and the side panel scroll inside it. */
export function ChatLayout() {
  return (
    <main className="relative box-border h-dvh min-h-[560px] overflow-hidden bg-canvas pt-14">
      <Outlet />
    </main>
  );
}
