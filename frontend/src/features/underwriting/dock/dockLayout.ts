import type { SerializedDockview } from "dockview-react";
import type { TabId } from "../artifact/ViewContent";

export const VIEW_IDS: readonly TabId[] = ["report", "graph", "sources", "logs"];
export const LAYOUT_KEY = "uw.dock.v1";

export const isView = (id: string): id is TabId => (VIEW_IDS as readonly string[]).includes(id);

/** A saved layout, if it is the shape we wrote and names only views we have; anything else is ignored. */
export function parseLayout(raw: string | undefined): SerializedDockview | undefined {
  if (!raw) return undefined;
  try {
    const layout = JSON.parse(raw) as Partial<SerializedDockview> | null;
    if (!layout || typeof layout !== "object" || !layout.grid || !layout.panels) return undefined;
    const panels = Object.values(layout.panels) as { id?: string; contentComponent?: string }[];
    const ok = panels.every((p) => typeof p.id === "string" && isView(p.id) && p.contentComponent === p.id);
    return ok ? (layout as SerializedDockview) : undefined;
  } catch {
    return undefined;
  }
}
