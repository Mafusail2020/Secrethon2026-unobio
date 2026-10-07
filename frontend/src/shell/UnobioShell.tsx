import { Outlet, useLocation } from "react-router-dom";
import { Footer } from "../unobio/Footer";
import { Navigation } from "../unobio/Navigation";
import { SiteFrame } from "../unobio/SiteFrame";

/** Header and footer are the copied unobio.com ones; the page between them is ours. */
export function UnobioShell() {
  const onHome = useLocation().pathname === "/";
  return (
    <>
      <SiteFrame>
        <Navigation dark={onHome} />
      </SiteFrame>
      <Outlet />
      <SiteFrame>
        <Footer />
      </SiteFrame>
    </>
  );
}
