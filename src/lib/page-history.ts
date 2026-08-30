import { createHash } from "node:crypto";

/**
 * Page version history — the pure half: what counts as a new version, how many we keep, and how
 * the panel groups them.
 *
 * No `server-only` and no I/O, so the rules most likely to go quietly wrong (dedupe and
 * retention) are unit-testable without a database.
 */

/**
 * Versions kept per page. A publish that touches twenty pages writes twenty rows, so this is
 * per-page rather than per-site — the cost scales with how often ONE page changes, which is the
 * thing a reader of the panel cares about.
 *
 * Bounded on purpose: unbounded history is a table that only grows, and nobody scrolls to the
 * fiftieth version of a page. If this ever needs to vary, `analyticsRetentionDays` is the
 * precedent for tying a retention limit to the plan.
 */
export const VERSIONS_PER_PAGE = 50;

/** Content identity, so republishing an unchanged page doesn't record a version. */
export function contentSha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 40);
}

/**
 * Should this publish record a version for this page?
 *
 * A publish writes every file in the draft buffer, including ones opened and left alone, so
 * without this a page picks up an identical version every time anything else on the site is
 * published — and the panel fills with entries that changed nothing.
 */
export function isNewVersion(input: {
  content: string;
  /** contentSha of the most recent version of this page, or null if there is none. */
  latestSha: string | null;
}): boolean {
  return contentSha(input.content) !== input.latestSha;
}

export type VersionRow = {
  id: string;
  publishedAt: Date;
  authorName: string | null;
  isCurrent: boolean;
};

export type VersionGroup = { label: string; versions: VersionRow[] };

/**
 * Group versions for the panel: newest first, under a day heading.
 *
 * "Today" and "Yesterday" rather than dates, because those are the two a reader is actually
 * looking for — anything older is being scanned by date anyway. Computed against a passed-in
 * `now` so the boundary is testable and so a server render and a later client render can't
 * disagree about what "today" means.
 */
export function groupVersionsByDay(versions: VersionRow[], now: Date): VersionGroup[] {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;

  const groups: VersionGroup[] = [];
  for (const version of versions) {
    const at = startOfDay(version.publishedAt);
    const label =
      at === today
        ? "Today"
        : at === today - day
          ? "Yesterday"
          : version.publishedAt.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: version.publishedAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
            });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.versions.push(version);
    else groups.push({ label, versions: [version] });
  }
  return groups;
}

/** `8:32 PM` — the time shown beside an author, matching the panel's per-row line. */
export function versionTime(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Initials for the author avatar. Falls back to a dash rather than rendering an empty circle. */
export function authorInitials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
