import type { DayBucket } from "@/lib/analytics-range";

// Brand-tinted bars (the platform blue→violet, not hosted docs platforms' green) so the chart
// reads as part of the papervine shell. Today's still-filling bucket is hatched to
// signal "partial", matching the reference design.
const SOLID = "linear-gradient(180deg, #6f9cff 0%, #5b8cff 100%)";
const HATCH =
  "repeating-linear-gradient(45deg, rgba(111,156,255,0.55) 0 6px, rgba(111,156,255,0.12) 6px 12px)";

export function VisitorsChart({
  data,
}: {
  data: Array<DayBucket & { count: number }>;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  // ~4 evenly spaced axis ticks, always including the last day.
  const tickEvery = Math.max(1, Math.ceil(data.length / 4));

  return (
    <div>
      <div className="relative flex h-64 items-end gap-1.5 border-b border-dashed border-[rgba(var(--ink-rgb),0.08)]">
        {data.map((d) => {
          const h = d.count === 0 ? 0 : Math.max(3, (d.count / max) * 100);
          return (
            <div
              key={d.key}
              className="flex flex-1 items-end justify-center"
              style={{ height: "100%" }}
            >
              <div
                title={`${d.label}: ${d.count} visitor${d.count === 1 ? "" : "s"}`}
                className="w-full max-w-16 rounded-md transition-opacity hover:opacity-80"
                style={{
                  height: `${h}%`,
                  minHeight: d.count > 0 ? 8 : 0,
                  background: d.partial ? HATCH : SOLID,
                }}
              />
            </div>
          );
        })}
        {total === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">
            No visitors in this range yet
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d, i) => (
          <div
            key={d.key}
            className="flex-1 text-center text-xs text-[var(--muted)]"
          >
            {i % tickEvery === 0 || i === data.length - 1 ? d.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
