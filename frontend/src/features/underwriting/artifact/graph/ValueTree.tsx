/** Generic collapsible view of any JSON value, for outputs whose shape we do not know. */
export function ValueTree({ value, depth = 0, label }: { value: unknown; depth?: number; label?: string }) {
  const name = label ? <span className="text-muted">{label}: </span> : null;
  if (value === null || value === undefined) {
    return (
      <div className="text-xs">
        {name}
        <span className="text-muted">none</span>
      </div>
    );
  }
  if (typeof value === "string") {
    return value.length > 160 ? (
      <details className="text-xs">
        <summary className="cursor-pointer">
          {name}
          {value.slice(0, 160)}…
        </summary>
        <p className="mt-1 whitespace-pre-wrap break-words">{value}</p>
      </details>
    ) : (
      <div className="break-words text-xs">
        {name}
        {value}
      </div>
    );
  }
  if (typeof value !== "object") {
    return (
      <div className="text-xs">
        {name}
        {String(value)}
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  return (
    <details open={depth < 1} className="text-xs">
      <summary className="cursor-pointer">
        {name}
        <span className="text-muted">{Array.isArray(value) ? `list of ${entries.length}` : `${entries.length} field${entries.length === 1 ? "" : "s"}`}</span>
      </summary>
      <ul className="ml-2 mt-0.5 space-y-0.5 border-l border-line pl-2">
        {entries.map(([key, child]) => (
          <li key={key}>
            <ValueTree value={child} depth={depth + 1} label={Array.isArray(value) ? undefined : key} />
          </li>
        ))}
      </ul>
    </details>
  );
}
