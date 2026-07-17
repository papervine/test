// Presentational credit meters (server components — no interactivity). Shared by the
// Usage settings surface. USAGE semantics: the bar FILLS as credits are consumed and
// the number is "used / included" — rendering *remaining* as a full bar once read as
// "all used up" to a real user (SPEC §10 Billing), so never do that.

export function UsageMeter({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (used / max) * 100)) : 0;
  const over = max > 0 && used > max;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-medium tabular-nums">
          {used.toLocaleString()}
          <span className="text-[var(--muted)]"> / {max.toLocaleString()} used</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(var(--ink-rgb),0.08)]">
        <div
          className={`h-full rounded-full ${over ? "bg-red-400" : "bg-[var(--blue)]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Trial/pack buckets have no monthly quota — just say what's left, no bar to misread.
export function RemainingLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="font-medium tabular-nums">
        {value.toLocaleString()}
        <span className="text-[var(--muted)]"> left</span>
      </span>
    </div>
  );
}
