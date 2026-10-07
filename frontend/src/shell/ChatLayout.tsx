import { Outlet } from "react-router-dom";

/** Fills the viewport under the fixed header; the footer follows below the fold. */
export function ChatLayout() {
  return (
    <main className="box-border min-h-screen bg-canvas pt-14 md:h-screen md:min-h-[640px]">
      <Outlet />
    </main>
  );
}
