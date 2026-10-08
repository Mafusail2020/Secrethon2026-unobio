import { DockviewReact, type DockviewReadyEvent, type DockviewTheme } from "dockview-react";
import { GraphPanel, LogsPanel, ReportPanel, SourcesPanel } from "./panels";

const THEME: DockviewTheme = { name: "workspace", className: "dockview-theme-uw", gap: 0 };
const COMPONENTS = { report: ReportPanel, graph: GraphPanel, sources: SourcesPanel, logs: LogsPanel };

/** Report, Graph, Sources and Logs as tabs the reader can drag: reorder, split beside or under each other, or float. */
export function ViewsDock({ onReady }: { onReady: (event: DockviewReadyEvent) => void }) {
  return <DockviewReact className="h-full w-full" components={COMPONENTS} theme={THEME} onReady={onReady} />;
}
