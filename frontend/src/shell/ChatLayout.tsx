import { Outlet } from "react-router-dom";

/** Fills the viewport under the fixed header; the footer follows below the fold. */
export function ChatLayout() {
  return (
    <main className="box-border h-screen min-h-[640px] bg-canvas pt-14">
      <Outlet />
    </main>
  );
}
