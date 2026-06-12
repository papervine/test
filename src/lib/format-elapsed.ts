// A live, ticking clock for an in-flight sync's elapsed time: "0:07", "1:42". Distinct from
// formatDurationMs (which labels a *finished* sync's wall-time, "2m 05s") — an active counter
// reads best as a steady m:ss that advances a second at a time. Clamped at 0 so a small clock
// skew between the row's server timestamp and the client's Date.now() can't show a negative
// count. Pure + standalone so the client ActivityFeed can import it without pulling in the
// server-coupled overview helpers, and so it's unit-testable with no DB/headers.
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
