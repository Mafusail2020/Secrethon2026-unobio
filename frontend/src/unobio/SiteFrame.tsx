import type { ReactNode } from "react";

// the root classes unobio.com puts on <html> and <body>; the copied CSS is scoped under .ub-site
const FONT_VARS = [
  "plus_jakarta_sans_7d753922-module__N5oDTq__variable",
  "jetbrains_mono_441f5847-module__jjj66q__variable",
  "geist_d05e4f1a-module__ElTFGq__variable",
  "newsreader_d2a5e122-module__x3szYq__variable",
].join(" ");

export function SiteFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ub-site">
      <div className={`${FONT_VARS} font-sans antialiased bg-atmosphere text-graphite tracking-body`}>
        {children}
      </div>
    </div>
  );
}
