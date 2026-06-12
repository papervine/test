// Pure helpers for the Site Overview home page (SPEC §10.3). Kept out of the page
// component so they're unit-testable with no DB/headers/cookies dependency.

export function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// The Activity feed's Live/Previews toggle maps onto `deployment.target`. Anything
// but the explicit "previews" param is the default Live view, so a stale/garbage
// query param degrades to Live rather than an empty feed.
export function parseFeedTarget(param: string | undefined): "live" | "preview" {
  return param === "previews" ? "preview" : "live";
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
  return "Manual Update";
}

// The expanded detail's Trigger field — the mechanism, independent of who.
export function triggerDetail(trigger: string | null): string {
  if (trigger === "webhook") return "GitHub push (auto-sync)";
  if (trigger === "manual") return "Manual re-sync";
  if (trigger === "connect") return "Repository connected";
  return "—";
}
