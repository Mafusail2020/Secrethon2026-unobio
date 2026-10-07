import { Outlet } from "react-router-dom";
import { Footer } from "./Footer";
import { Navbar } from "./Navbar";

export function UnobioShell() {
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
