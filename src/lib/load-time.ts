// Formatting + tone for the site-preview load-time read-out (SitePreview). Pure so it can
// be unit-tested without a browser: the component just measures wall-clock and renders this.
// Sub-second reads as whole ms ("131ms"); slower reads as one-decimal seconds ("6.0s").
// Tone mirrors the status palette — green = snappy, amber = sluggish, red = slow.
export type LoadTone = "good" | "ok" | "slow";

// Solid dot fill vs. text color, kept separate so callers can use whichever the layout needs.
const DOT_CLASS: Record<LoadTone, string> = {
  good: "bg-emerald-400",
  ok: "bg-amber-400",
  slow: "bg-red-400",
};
const TEXT_CLASS: Record<LoadTone, string> = {
  good: "text-emerald-400",
  ok: "text-amber-400",
  slow: "text-red-400",
};

export function formatLoadTime(ms: number): {
  label: string;
  tone: LoadTone;
  dotClass: string;
  textClass: string;
} {
  const safe = ms < 0 ? 0 : ms;
  const seconds = safe / 1000;
  const tone: LoadTone = seconds < 1 ? "good" : seconds < 3 ? "ok" : "slow";
  const label = seconds < 1 ? `${Math.round(safe)}ms` : `${seconds.toFixed(1)}s`;
  return { label, tone, dotClass: DOT_CLASS[tone], textClass: TEXT_CLASS[tone] };
}
