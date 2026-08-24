// Shared presentation helpers for automation runs (history table + run detail).

// What a finished run actually did. `resultRef` is a commit sha or a PR URL, and it is NOT a
// proxy for "did anything change": a Papervine-hosted site publishes straight to object storage
// (SPEC §10.11), so it has neither a sha nor a PR URL and its ref is null forever. Reading null
// as "nothing changed" labelled every successful hosted publish "no changes" — on a run detail
// page that listed the file it changed and a summary describing the edit.
//
// `changedFileCount` is the authoritative signal, but a missing ref is still checked first so a
// legacy row that has a sha and no recorded changedFiles keeps reading as a real result.
export function runDidChangeNothing(input: {
  resultRef: string | null;
  changedFileCount: number;
}): boolean {
  return !input.resultRef && input.changedFileCount === 0;
}

// A succeeded run that changed nothing is the reference's distinct "No changes" outcome —
// same lifecycle, different story for the reader.
// `changedFileCount` is deliberately REQUIRED, not defaulted to 0: a default would let a call
// site that forgets it silently reproduce the original bug, and the compiler is a better guard
// than a test for that.
export function runDisplayStatus(
  status: string,
  resultRef: string | null,
  changedFileCount: number,
): string {
  if (status === "review_needed") return "review needed";
  return status === "succeeded" && runDidChangeNothing({ resultRef, changedFileCount })
    ? "no changes"
    : status;
}

// How the run detail's "Result" row reads:
//   "ref"       — a commit sha or PR URL to show (Git-backed).
//   "published" — it changed files but has no ref: a hosted site's publish went straight live.
//   "none"      — it genuinely changed nothing.
//   "pending"   — not a succeeded run; there's no result to report yet.
export type RunResultKind = "ref" | "published" | "none" | "pending";

export function runResultKind(input: {
  status: string;
  resultRef: string | null;
  changedFileCount: number;
}): RunResultKind {
  if (input.resultRef) return "ref";
  if (input.status !== "succeeded") return "pending";
  return input.changedFileCount > 0 ? "published" : "none";
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
