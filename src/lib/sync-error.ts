// Pure helper for recording a failed sync's reason on its deployment row.
// Lives outside the `"use server"` actions file so it stays sync-exportable and
// unit-testable (see tests/unit/sync-error.test.ts). The captured detail is what
// the dashboard Activity feed shows on failed rows — otherwise the *why* is lost
// to serverless logs the user can't reach.

// Message + a trimmed stack — enough to diagnose, capped so a runaway error
// (or a giant upstream response baked into the message) can't bloat the row.
export function syncErrorDetail(e: unknown): string {
  const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
  return detail.slice(0, 2000);
}
