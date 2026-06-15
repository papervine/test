// Classify a caught dashboard error so the boundary (SPEC §10.7) can pick its copy.
// A dropped RSC navigation fetch surfaces as "Failed to fetch" (Chrome), "Load failed"
// (Safari), or "NetworkError" (Firefox) — for those we say "the connection dropped, retry"
// rather than the scarier generic "something went wrong". Pure so it's unit-testable.
export function isNetworkError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /failed to fetch|load failed|networkerror/i.test(message);
}
