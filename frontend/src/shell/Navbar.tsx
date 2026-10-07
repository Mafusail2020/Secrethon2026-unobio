import { NavLink } from "react-router-dom";

const EXTERNAL = [
  "Diligence",
  "Licensing & Pipeline",
  "Blog",
  "About Us",
  "Contact Us",
] as const;

export function Navbar() {
  return (
    <header className="border-b border-line bg-white">
      <nav className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4">
        <NavLink to="/underwriting" className="font-heading text-lg font-bold text-navy">
          Unobio
        </NavLink>
        <ul className="flex items-center gap-5 text-sm">
          {EXTERNAL.map((label) => (
            <li key={label}>
              <a
                href="https://unobio.com"
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-ink"
              >
                {label}
              </a>
            </li>
          ))}
          <li>
            <NavLink
              to="/underwriting"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 font-medium ${
                  isActive ? "bg-navy text-white" : "text-muted hover:text-ink"
                }`
              }
            >
              Underwriting
            </NavLink>
          </li>
        </ul>
      </nav>
    </header>
  );
}
