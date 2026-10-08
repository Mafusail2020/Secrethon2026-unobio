import type { Decision } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { GraphIcon, LogsIcon, ReportIcon, SidebarIcon, SourcesIcon } from "../../components/ui/icons";
import { DECISION_LABEL, DECISION_STYLE } from "../../lib/format";
import type { TabId } from "./artifact/ViewContent";

const VIEWS: { id: TabId; label: string; Icon: typeof GraphIcon; needsRun: boolean }[] = [
  { id: "report", label: "Report", Icon: ReportIcon, needsRun: true },
  { id: "graph", label: "Graph", Icon: GraphIcon, needsRun: false },
  { id: "sources", label: "Sources", Icon: SourcesIcon, needsRun: true },
  { id: "logs", label: "Logs", Icon: LogsIcon, needsRun: true },
];

/** Title on the left; the Report, Graph, Sources and Logs views open and close from the right. */
export function TopBar({
  title,
  decision,
  hasRun,
  open,
  onTogglePanel,
  sidebarOpen,
  onToggleSidebar,
}: {
  title: string;
  decision: Decision | undefined;
  hasRun: boolean;
  open: readonly TabId[];
  onTogglePanel: (id: TabId) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-3">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide the history" : "Show the history"}
        aria-expanded={sidebarOpen}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        <SidebarIcon />
      </button>
      <h1 className="min-w-0 truncate text-sm font-medium">{title}</h1>
      {decision && <Badge className={`hidden sm:inline-flex ${DECISION_STYLE[decision]}`}>{DECISION_LABEL[decision]}</Badge>}
      <div role="group" aria-label="Open a view" className="ml-auto flex items-center gap-0.5">
        {VIEWS.map(({ id, label, Icon, needsRun }) => {
          const disabled = needsRun && !hasRun;
          const pressed = open.includes(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTogglePanel(id)}
              disabled={disabled}
              aria-pressed={pressed}
              aria-controls="artifact-panel"
              aria-label={label}
              title={disabled ? `${label} is available once a run has started` : label}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40 ${
                pressed ? "bg-slate-200 font-medium text-ink" : "text-muted hover:bg-slate-100 hover:text-ink"
              }`}
            >
              <Icon width={18} height={18} />
              <span className="hidden lg:inline">{label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
