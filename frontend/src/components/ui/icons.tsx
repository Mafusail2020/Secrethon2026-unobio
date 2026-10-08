import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const PlusIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const SidebarIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <svg {...base} strokeWidth={2.2} {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const ReportIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M7 3.5h7.5L19 8v12.5H7z" />
    <path d="M14 3.5V8.5h5M10 13h6M10 16.5h6" />
  </svg>
);

export const GraphIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="18" cy="8" r="2.2" />
    <circle cx="12" cy="18" r="2.2" />
    <path d="m7.9 7 8.2.8M7 8l4 8M16.9 9.8 13.1 16" />
  </svg>
);

export const SourcesIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

export const LogsIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base} {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** The eight-point burst used as the workspace mark. */
export const SparkIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 1.5c.6 4.7 1.1 5.7 2.4 7.1 1.4 1.3 2.4 1.8 7.1 2.4-4.7.6-5.7 1.1-7.1 2.4-1.3 1.4-1.8 2.4-2.4 7.1-.6-4.7-1.1-5.7-2.4-7.1-1.4-1.3-2.4-1.8-7.1-2.4 4.7-.6 5.7-1.1 7.1-2.4C10.9 7.2 11.4 6.2 12 1.5Z" />
  </svg>
);
