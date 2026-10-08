import { Outlet } from "react-router-dom";

/** Fills the viewport under the fixed header; below md the columns stack and the page scrolls. */
export function ChatLayout() {
  return (
    <main className="relative box-border min-h-screen bg-canvas pt-14 md:h-screen md:min-h-[640px] md:overflow-hidden">
      <Outlet />
    </main>
  );
}
