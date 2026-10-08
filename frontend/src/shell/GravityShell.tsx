import { Outlet, ScrollRestoration } from "react-router-dom";
import { Navigation } from "../unobio/Navigation";
import { SiteFrame } from "../unobio/SiteFrame";

/** The workspace fills the viewport, so it gets the site header but no footer. */
export function GravityShell() {
  return (
    <>
      <ScrollRestoration />
      <SiteFrame>
        <Navigation dark={false} />
      </SiteFrame>
      <Outlet />
    </>
  );
}
