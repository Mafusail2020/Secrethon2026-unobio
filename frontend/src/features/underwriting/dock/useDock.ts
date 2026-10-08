import type { DockviewApi, DockviewReadyEvent } from "dockview-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { readPref, writePref } from "../../../lib/storage";
import type { TabId } from "../artifact/ViewContent";
import { VIEW_TITLE } from "../artifact/views";
import { isView, LAYOUT_KEY, parseLayout } from "./dockLayout";

function show(api: DockviewApi, id: TabId) {
  const panel = api.getPanel(id);
  if (panel) panel.api.setActive();
  else api.addPanel({ id, component: id, title: VIEW_TITLE[id] });
}

/**
 * The views as dock panels: open and close them by id, and keep track of which are open.
 * On a run page the arrangement (what sits where, and how big) is saved and brought back next time.
 */
export function useDock({ persist, initial }: { persist: boolean; initial: TabId | null }) {
  const api = useRef<DockviewApi | null>(null);
  const waiting = useRef<TabId[]>(initial ? [initial] : []);
  const saveTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState<TabId[]>([]);

  const open_ = useCallback((id: TabId) => {
    if (api.current) show(api.current, id);
    else waiting.current.push(id); // asked for before the dock has mounted
  }, []);

  const toggle = useCallback(
    (id: TabId) => {
      const panel = api.current?.getPanel(id);
      if (api.current && panel) api.current.removePanel(panel);
      else open_(id);
    },
    [open_],
  );

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const dock = event.api;
      api.current = dock;
      const saved = persist ? parseLayout(readPref(LAYOUT_KEY)) : undefined;
      if (saved) {
        try {
          dock.fromJSON(saved);
        } catch {
          dock.clear();
        }
      }
      waiting.current.forEach((id) => show(dock, id));
      waiting.current = [];
      const sync = () => setOpen(dock.panels.map((p) => p.id).filter(isView));
      sync();
      dock.onDidLayoutChange(() => {
        sync();
        if (!persist) return;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => writePref(LAYOUT_KEY, JSON.stringify(dock.toJSON())), 250);
      });
    },
    [persist],
  );

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  return { open, show: open_, toggle, onReady };
}
