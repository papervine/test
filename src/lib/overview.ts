// Pure helpers for the Site Overview home page (SPEC §10.3). Kept out of the page
// component so they're unit-testable with no DB/headers/cookies dependency — and so the
// client-side ActivityFeed can share the same formatting/transport logic as the server.

export type FeedTarget = "live" | "preview";

// One Activity-feed row, transport-shaped: `createdAt` is epoch ms (not a Date) so the
// row survives JSON serialization to the polling client unchanged (SPEC §10.3 live feed).
export type ActivityRow = {
  id: string;
  status: string;
  commitMessage: string | null;
  commitSha: string | null;
  error: string | null;
  filesAdded: number;
  filesEdited: number;
  trigger: string | null;
  // The immutable content tree this deploy produced (SPEC §10.11) — what a rollback restores.
  // Null on rows that predate revisions, which is exactly why `canRollBack` refuses them.
  revisionId: string | null;
  durationMs: number | null;
  createdAt: number;
  actorName: string | null;
};

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// The Activity feed's Live/Previews toggle maps onto `deployment.target`. Anything
// but the explicit "previews" param is the default Live view, so a stale/garbage
// query param degrades to Live rather than an empty feed.
export function parseFeedTarget(param: string | undefined): FeedTarget {
  return param === "previews" ? "preview" : "live";
}

// Inverse of parseFeedTarget — the `?feed=` query value for a target. The polling client
// asks the JSON endpoint for the same tab it's showing.
export function feedParam(target: FeedTarget): string {
  return target === "preview" ? "previews" : "live";
}

// How long the ActivityFeed waits before re-polling. The durable `deployment` row goes
// in as `building` and flips to successful/failed at sync end (sync-runner), so an
// in-flight sync IS visible as a `building` row: poll fast while one's running (catch the
// transition live), idle slowly otherwise. Pure so the cadence is unit-tested, not the
// effect.
export function pollDelayMs(rows: readonly { status: string }[]): number {
  return rows.some((r) => r.status === "building") ? 2_500 : 20_000;
}

// A `building` deployment younger than this is treated as a live, in-flight sync; older
// than this it's an orphan (its serverless function was killed mid-run — no catch flips it
// to failed), so it must NOT block a fresh re-sync forever. Sized to the sync route ceiling
// (maxDuration=300s) plus slack.
export const SYNC_INFLIGHT_MS = 5 * 60_000;

// Is a sync in flight, given the newest `building` row's timestamp (epoch ms, or null if
// none)? Pure so the re-sync guard's decision is unit-tested, not just the DB action.
export function syncInFlight(
  newestBuildingMs: number | null,
  now: number = Date.now(),
): boolean {
  return newestBuildingMs != null && now - newestBuildingMs < SYNC_INFLIGHT_MS;
}

// Relative "x ago" from an epoch-ms timestamp. Takes ms (not a Date) so it works for both
// the server-rendered "last updated" line and the client feed's JSON rows.
export function timeAgo(ms: number, now: number = Date.now()): string {
  const secs = Math.floor((now - ms) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Human-readable sync wall-time for the feed's expanded detail: "412ms", "1.4s", "2m 05s".
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

// The feed byline's "who/what did this". Webhook syncs have no actor (the push did it),
// which used to fall through to "Manual Update" — misleading. Rows older than the
// trigger column keep the legacy fallback.
export function triggerLabel(
  trigger: string | null,
  actorName: string | null,
): string {
  if (trigger === "webhook") return "GitHub push";
  if (actorName) return actorName;
  // Actor-less publishes/creates do happen (an automation, the authoring MCP), and calling
  // those a "Manual Update" would be plainly wrong.
  if (trigger === "publish") return "Published";
  if (trigger === "create") return "Site created";
  if (trigger === "rollback") return "Rolled back";
  return "Manual Update";
}

// The expanded detail's Trigger field — the mechanism, independent of who.
export function triggerDetail(trigger: string | null): string {
  if (trigger === "webhook") return "GitHub push (auto-sync)";
  if (trigger === "manual") return "Manual re-sync";
  if (trigger === "connect") return "Repository connected";
  // Papervine-hosted sites (SPEC §10.11): published from the editor, or seeded at creation.
  if (trigger === "publish") return "Published from the editor";
  if (trigger === "create") return "Site created";
  // A rollback writes no content — it re-points the site at an earlier deployment's revision.
  if (trigger === "rollback") return "Restored an earlier deployment";
  return "—";
}
