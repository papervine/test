"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCompact, type UsageChartData, type UsageDay } from "@/lib/usage-series";

// Credits consumed per day, stacked by feature (SPEC §10 Billing) — the "where did the
// credits go" view the meter above can't give. Hand-rolled like VisitorsChart: no chart
// library in this repo, and a stacked bar + hover layer is a few divs.
//
// Series colors come from the validated --series-N slots in platform.css (fixed order,
// carried on the series itself), so light/dark swap with the platform theme and a range
// with no editor-agent usage can't repaint the series that remain. The legend and the
// tooltip both label every series, so identity is never color-alone; the recent-usage
// table below the chart is the non-visual path to the same numbers.

const PLOT_H = "h-56"; // 224px — tall enough for a 30-day stack to be readable

export function UsageChart({
  data,
  rangeLabel,
}: {
  data: UsageChartData;
  rangeLabel: string;
}) {
  const { series, days, axisMax, ticks } = data;
  const [active, setActive] = useState<number | null>(null);
  const empty = data.credits === 0;
  // Axis heights divide by this; an empty window has no max to scale against.
  const scale = axisMax > 0 ? axisMax : 1;
  // ~6 date labels whatever the window length, always including the last day.
  const tickEvery = Math.max(1, Math.ceil(days.length / 6));
  // Palette slots, index-aligned with each day's `values` (color follows the series).
  const slots = series.map((s) => s.slot);

  function move(delta: number) {
    setActive((i) => {
      const next = i === null ? days.length - 1 : i + delta;
      return Math.min(days.length - 1, Math.max(0, next));
    });
  }

  return (
    <Card className="max-w-4xl gap-0 overflow-hidden p-0" data-testid="usage-chart">
      <div className="flex items-baseline justify-between px-5 pt-5">
        {/* "Credit usage", not "Usage" — the page's own h1 is Usage, and two headings
            with one name is a worse surface to read (and to target in a test). */}
        <h2 className="text-sm font-semibold">Credit usage</h2>
        <span className="text-xs text-[var(--muted)]">{rangeLabel}</span>
      </div>

      <div className="px-5 pb-3 pt-6">
        <div className="flex gap-2" onMouseLeave={() => setActive(null)}>
          {/* Y axis — labels hang off the plot so the plot's own width stays the day grid. */}
          <div className={`relative w-8 shrink-0 ${PLOT_H}`} aria-hidden="true">
            {(empty ? [0] : ticks).map((t) => (
              <span
                key={t}
                className="absolute right-0 translate-y-1/2 text-[10px] tabular-nums text-[var(--muted)]"
                style={{ bottom: `${(t / scale) * 100}%` }}
              >
                {formatCompact(t)}
              </span>
            ))}
          </div>

          <div
            className="relative flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            tabIndex={0}
            role="img"
            aria-label={summarize(data, rangeLabel)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(1);
              else if (e.key === "ArrowLeft") move(-1);
              else if (e.key === "Escape") setActive(null);
              else return;
              e.preventDefault();
            }}
          >
            {/* Gridlines, one per tick — recessive, and the 0 line doubles as the baseline. */}
            <div className={`relative ${PLOT_H}`}>
              {(empty ? [0] : ticks).map((t) => (
                <div
                  key={t}
                  className="absolute inset-x-0 border-t border-[rgba(var(--ink-rgb),0.06)]"
                  style={{ bottom: `${(t / scale) * 100}%` }}
                />
              ))}

              <div className="relative flex h-full items-end">
                {days.map((d, i) => (
                  <div
                    key={d.key}
                    // The day key is the hover target's handle for e2e (a bar has no text
                    // and no role to find it by).
                    data-day={d.key}
                    className="relative flex h-full flex-1 items-end justify-center"
                    onMouseEnter={() => setActive(i)}
                  >
                    {/* Hover column — a hit target the full height of the plot, so a
                        short day is as easy to read as a tall one. */}
                    <div
                      className={`absolute inset-y-0 inset-x-[1px] rounded-sm bg-[rgba(var(--ink-rgb),0.05)] transition-opacity ${
                        active === i ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <Bar day={d} scale={scale} slots={slots} />
                  </div>
                ))}
              </div>

              {empty && (
                <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">
                  No AI usage in this range yet
                </div>
              )}
            </div>

            {active !== null && days[active].credits > 0 && (
              <Tooltip
                day={days[active]}
                series={series}
                // Anchor on the hovered column's center, then flip sides past the
                // midpoint so the panel never leaves the card.
                left={((active + 0.5) / days.length) * 100}
                flip={active > days.length / 2}
              />
            )}

            <div className="mt-2 flex" aria-hidden="true">
              {days.map((d, i) => (
                <div
                  key={d.key}
                  className="flex-1 text-center text-[11px] whitespace-nowrap text-[var(--muted)]"
                >
                  {i % tickEvery === 0 || i === days.length - 1 ? d.label : ""}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {series.length > 0 && (
        <div
          data-testid="usage-legend"
          className="flex flex-wrap border-t border-[rgba(var(--ink-rgb),0.06)] bg-[rgba(var(--ink-rgb),0.02)]"
        >
          {series.map((s) => (
            <div
              key={s.key}
              className="flex min-w-[190px] flex-1 items-center justify-between gap-3 border-l border-[rgba(var(--ink-rgb),0.06)] px-4 py-2.5 first:border-l-0"
            >
              <span className="flex items-center gap-2 text-xs text-[var(--fg)]">
                <Swatch slot={s.slot} />
                {s.label}
              </span>
              <span className="text-xs tabular-nums">
                <span className="font-medium">{formatCompact(s.credits)}</span>{" "}
                <span className="text-[var(--muted)]">{s.pct}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// One day's stack. Segments are laid out bottom-up (column-reverse) with a 2px surface
// gap between fills, and only the topmost fill is rounded — the stack stays anchored to
// the baseline. Empty segments are dropped so the gaps don't accumulate under a bar.
function Bar({
  day,
  scale,
  slots,
}: {
  day: UsageDay;
  scale: number;
  slots: number[];
}) {
  const top = day.values.reduce((last, v, i) => (v > 0 ? i : last), -1);
  return (
    <div className="relative flex h-full w-full max-w-[14px] flex-col-reverse justify-start gap-[2px]">
      {day.values.map((v, i) =>
        v > 0 ? (
          <div
            key={i}
            className={i === top ? "rounded-t-[4px]" : ""}
            style={{
              height: `${(v / scale) * 100}%`,
              minHeight: 2,
              background: `var(--series-${slots[i] ?? 0})`,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

function Tooltip({
  day,
  series,
  left,
  flip,
}: {
  day: UsageDay;
  series: UsageChartData["series"];
  left: number;
  flip: boolean;
}) {
  return (
    // Opaque fill, not `db-glass`: the panel sits ON the bars, and at 60% they read
    // through it (the same reason the dropdown/popover surfaces are opaque).
    <div
      role="status"
      data-testid="usage-tooltip"
      className="pointer-events-none absolute top-2 z-10 w-52 overflow-hidden rounded-lg border border-[rgba(var(--ink-rgb),0.1)] bg-[var(--option-bg)] shadow-xl shadow-black/40"
      style={{
        left: `${left}%`,
        transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
      }}
    >
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {series.map((s, i) => {
          const v = day.values[i] ?? 0;
          return (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <Swatch slot={s.slot} />
              <span className="flex-1 truncate text-[var(--fg)]">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-medium">{formatCompact(v)}</span>{" "}
                <span className="text-[var(--muted)]">
                  {day.credits > 0 ? Math.round((v / day.credits) * 1000) / 10 : 0}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[rgba(var(--ink-rgb),0.08)] px-3 py-2 text-xs text-[var(--muted)]">
        {/* Today's bar is still filling — say so, or a short last column reads as a drop. */}
        {day.partial ? `${day.full} · so far today` : day.full}
      </div>
    </div>
  );
}

function Swatch({ slot }: { slot: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
      style={{ background: `var(--series-${slot})` }}
    />
  );
}

// The chart's accessible summary — the shape of the window in one sentence. The exact
// numbers live in the legend and in the recent-usage table below it.
function summarize(data: UsageChartData, rangeLabel: string): string {
  if (data.credits === 0) return `Daily credit usage, ${rangeLabel}: no usage yet.`;
  const parts = data.series.map(
    (s) => `${s.label} ${formatCompact(s.credits)} (${s.pct}%)`,
  );
  return `Daily credit usage, ${rangeLabel}: ${formatCompact(
    data.credits,
  )} credits — ${parts.join(", ")}. Use the arrow keys to read a day.`;
}
