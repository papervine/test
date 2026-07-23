// Shared presentation helpers for automation runs (history table + run detail).

// A succeeded run that produced no commit/PR is the reference's distinct "No changes"
// outcome — same lifecycle, different story for the reader.
export function runDisplayStatus(status: string, resultRef: string | null): string {
  if (status === "review_needed") return "review needed";
  return status === "succeeded" && !resultRef ? "no changes" : status;
}

export const RUN_STATUS_STYLES: Record<string, string> = {
  queued: "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--muted)]",
  running: "bg-sky-500/15 text-sky-300",
  succeeded: "bg-emerald-500/15 text-emerald-300",
  "no changes": "bg-emerald-500/10 text-emerald-300/70",
  "review needed": "bg-amber-500/15 text-amber-400",
  rejected: "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--muted)]",
  failed: "bg-red-500/15 text-red-300",
  canceled: "bg-[rgba(var(--ink-rgb),0.08)] text-[var(--muted)]",
};

export function runStatusChipClass(displayStatus: string): string {
  return RUN_STATUS_STYLES[displayStatus] ?? RUN_STATUS_STYLES.queued;
}
