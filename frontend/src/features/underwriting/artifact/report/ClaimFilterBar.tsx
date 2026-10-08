import type { Claim } from "../../../../api/types";
import { facetCounts, isFiltering, toggleValue, type ClaimFilters, emptyFilters } from "./claimFilters";
import { LABEL_ORDER } from "./labels";

function Facet<T extends string>({
  title,
  values,
  selected,
  counts,
  onToggle,
}: {
  title: string;
  values: T[];
  selected: ReadonlySet<T>;
  counts: Map<T, number>;
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1">
      <legend className="sr-only">{title}</legend>
      <span className="mr-1 text-xs text-muted" aria-hidden="true">
        {title}
      </span>
      {values.map((value) => (
        <label
          key={value}
          className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand ${
            selected.has(value) ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:border-brand"
          } ${counts.get(value) ? "" : "opacity-50"}`}
        >
          <input type="checkbox" className="sr-only" checked={selected.has(value)} onChange={() => onToggle(value)} />
          {value} <span className="tabular-nums">{counts.get(value) ?? 0}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ClaimFilterBar({
  claims,
  filters,
  shown,
  onChange,
}: {
  claims: Claim[];
  filters: ClaimFilters;
  shown: number;
  onChange: (filters: ClaimFilters) => void;
}) {
  return (
    <div className="space-y-2" role="search" aria-label="Filter claims">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="claim-search">
          Search claims
        </label>
        <input
          id="claim-search"
          type="search"
          value={filters.query}
          onChange={(e) => onChange({ ...filters, query: e.target.value })}
          placeholder="Search claims and evidence quotes"
          className="min-w-0 flex-1 rounded-full border border-line px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        />
        <span className="shrink-0 text-xs text-muted" role="status">
          {shown} of {claims.length}
        </span>
        {isFiltering(filters) && (
          <button type="button" onClick={() => onChange(emptyFilters)} className="shrink-0 text-xs text-brand hover:underline">
            Clear
          </button>
        )}
      </div>
      <Facet title="Stance" values={["pro", "con", "neutral"]} selected={filters.stance} counts={facetCounts(claims, "stance")} onToggle={(v) => onChange({ ...filters, stance: toggleValue(filters.stance, v) })} />
      <Facet title="Label" values={LABEL_ORDER} selected={filters.label} counts={facetCounts(claims, "label")} onToggle={(v) => onChange({ ...filters, label: toggleValue(filters.label, v) })} />
      <Facet title="Status" values={["accepted", "downgraded", "rejected"]} selected={filters.status} counts={facetCounts(claims, "status")} onToggle={(v) => onChange({ ...filters, status: toggleValue(filters.status, v) })} />
      <Facet title="Confidence" values={["high", "medium", "low"]} selected={filters.confidence} counts={facetCounts(claims, "confidence")} onToggle={(v) => onChange({ ...filters, confidence: toggleValue(filters.confidence, v) })} />
    </div>
  );
}
