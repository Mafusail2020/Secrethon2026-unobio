import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";

const LINKS = ["Diligence", "Licensing & Pipeline", "Blog", "About Us", "Contact Us"];

function Logo({ textColor }: { textColor: string }) {
  return (
    <div className="flex items-center gap-3">
      <img
        alt="Unobio Logo"
        width="36"
        height="36"
        className="h-9 w-9 object-contain"
        src="/unobio/images/logo_ui.png"
      />
      <span className={`text-lg font-medium font-switzer tracking-subheading ${textColor}`}>Unobio</span>
    </div>
  );
}

/** unobio.com's header: transparent until the page scrolls, then a blurred bar. Only the logo and Gravity are links. */
export function Navigation({ dark }: { dark: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const link = dark
    ? "text-white/75 hover:text-white transition-colors duration-150 text-[15px] font-normal"
    : "text-slate hover:text-graphite transition-colors duration-150 text-[15px] font-normal";
  const blur = dark ? "saturate(180%) blur(20px)" : "saturate(180%) blur(12px)";

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 nav-enter transition-all duration-300"
      style={{
        backdropFilter: scrolled ? blur : "none",
        WebkitBackdropFilter: scrolled ? blur : "none",
        background: scrolled ? (dark ? "rgba(4, 8, 26, 0.92)" : "rgba(247, 248, 250, 0.85)") : "transparent",
        borderBottom: scrolled
          ? dark
            ? "1px solid rgba(255, 255, 255, 0.10)"
            : "1px solid rgba(232, 232, 237, 0.5)"
          : "1px solid transparent",
      }}
    >
      <div className="max-w-content mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">
          <Link to="/" className="flex items-center">
            <Logo textColor={dark ? "text-white" : "text-graphite"} />
          </Link>
          <div className="hidden md:flex items-center gap-7">
            {LINKS.map((label) => (
              <a key={label} className={link}>
                {label}
              </a>
            ))}
            <NavLink
              to="/underwriting"
              className={link}
              style={({ isActive }) => (isActive ? { color: dark ? "#fff" : "rgb(29, 29, 31)" } : undefined)}
            >
              Gravity
            </NavLink>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <a className={link}>Log in</a>
            <a className="rounded-full bg-signal-blue text-white px-5 py-2 text-[14px] font-medium hover:bg-deep-signal transition-colors duration-150">
              Become partner
            </a>
          </div>
          <button type="button" className={`md:hidden p-2 ${dark ? "text-white" : "text-graphite"}`} aria-label="Toggle menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
