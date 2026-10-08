import { useEffect, useMemo, useRef, useState } from "react";
import { traceUrl } from "../../../../api/client";
import type { RunEvent } from "../../../../api/types";
import { humanize } from "../../../../lib/format";
import { describeEvent, eventLevel, filterEvents, groupByNode, noLogFilters, offsetSeconds, toText, type LogFilters, type MinLevel } from "./logView";

const TYPE_STYLE: Record<string, string> = {
  "node.failed": "text-red-600",
  "run.failed": "text-red-600",
  "node.skipped": "text-amber-600",
  "node.reused": "text-violet-600",
  "run.completed": "text-emerald-600",
  "node.completed": "text-emerald-600",
};

const field = "rounded border border-line bg-white px-1.5 py-0.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

function Row({ event, first }: { event: RunEvent; first: string | undefined }) {
  const level = eventLevel(event);
  return (
    <li className="grid grid-cols-[3rem_4rem_9rem_7.5rem_1fr] gap-2 border-b border-line py-0.5 [content-visibility:auto]">
      <span className="text-muted">#{event.seq}</span>
      <span className="text-muted">{first ? offsetSeconds(first, event.ts) : ""}</span>
      <span className="truncate" title={event.node_id ?? undefined}>
        {event.node_id ?? "run"}
      </span>
      <span className={TYPE_STYLE[event.type] ?? "text-muted"}>{event.type}</span>
      <span className={`break-words ${level === "error" ? "text-red-700" : level === "warn" ? "text-amber-700" : ""}`}>{describeEvent(event)}</span>
    </li>
  );
}

export function LogsTimeline({ events, runId }: { events: RunEvent[]; runId: string }) {
  const [filters, setFilters] = useState<LogFilters>(noLogFilters);
  const [grouped, setGrouped] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLOListElement>(null);
  const download = traceUrl(runId);

  const nodes = useMemo(() => [...new Set(events.flatMap((e) => (e.node_id ? [e.node_id] : [])))], [events]);
  const shown = useMemo(() => filterEvents(events, filters), [events, filters]);
  const groups = useMemo(() => (grouped ? groupByNode(shown) : []), [grouped, shown]);
  const first = events[0]?.ts;

  useEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, shown.length, grouped]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(shown));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-white px-4 py-2 text-xs" role="search" aria-label="Filter log">
        <label className="flex items-center gap-1">
          Step
          <select className={field} value={filters.node} onChange={(e) => setFilters({ ...filters, node: e.target.value })}>
            <option value="">all</option>
            {nodes.map((n) => (
              <option key={n} value={n}>
                {humanize(n)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Level
          <select className={field} value={filters.minLevel} onChange={(e) => setFilters({ ...filters, minLevel: e.target.value as MinLevel })}>
            <option value="all">all</option>
            <option value="warn">warnings and errors</option>
            <option value="error">errors only</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="sr-only">Search the log</span>
          <input type="search" placeholder="Search" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} className={`${field} w-40`} />
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by step
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Auto-scroll
        </label>
        <span className="text-muted" role="status">
          {shown.length} of {events.length} events
        </span>
        <span className="ml-auto flex items-center gap-3">
          <button type="button" onClick={copy} className="text-brand hover:underline">
            {copied ? "Copied" : "Copy"}
          </button>
          {download && (
            <a className="text-brand hover:underline" href={download} download>
              Download trace
            </a>
          )}
        </span>
      </div>
      <ol ref={scroller} className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs" aria-label="Run log" tabIndex={0}>
        {events.length === 0 && <li className="text-muted">Waiting for events…</li>}
        {events.length > 0 && shown.length === 0 && <li className="text-muted">No events match these filters.</li>}
        {grouped
          ? groups.map((g) => (
              <li key={g.node ?? "run"} className="mb-2">
                <details open>
                  <summary className="cursor-pointer font-semibold">
                    {g.node ? humanize(g.node) : "Run"} <span className="font-normal text-muted">({g.events.length})</span>
                  </summary>
                  <ol>
                    {g.events.map((e) => (
                      <Row key={e.seq} event={e} first={first} />
                    ))}
                  </ol>
                </details>
              </li>
            ))
          : shown.map((e) => <Row key={e.seq} event={e} first={first} />)}
      </ol>
    </div>
  );
}
