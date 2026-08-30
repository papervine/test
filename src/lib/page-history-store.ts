import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "./db";
import { pageVersion, site as siteTable } from "./db/app-schema";
import { user } from "./db/schema";
import { contentSha, isNewVersion, VERSIONS_PER_PAGE, type VersionRow } from "./page-history";

/** Only page files get history — assets and `docs.json` aren't what the panel is about. */
const PAGE_FILE = /\.mdx?$/i;

export type RecordInput = {
  siteId: string;
  /** Docs-relative file paths → the content published, for a Papervine-hosted site. */
  pages: { path: string; content: string }[];
  actorUserId: string | null;
  deploymentId: string | null;
  /** Git-backed sites: the commit this publish became. Content is not stored for these. */
  commitSha?: string | null;
};

/**
 * Record one version per changed page (SPEC §10.11).
 *
 * Called after a publish has SUCCEEDED, and deliberately never allowed to fail it: history is
 * a convenience, and losing a version row is a much smaller problem than a publish that reports
 * failure after the bytes are already live.
 */
export async function recordPageVersions(input: RecordInput): Promise<number> {
  const pages = input.pages.filter((p) => PAGE_FILE.test(p.path));
  if (pages.length === 0) return 0;

  try {
    // The newest sha per path, to skip pages this publish didn't actually change. One query for
    // the batch rather than one per page.
    const latest = await db
      .select({ path: pageVersion.path, contentSha: pageVersion.contentSha, publishedAt: pageVersion.publishedAt })
      .from(pageVersion)
      .where(
        and(
          eq(pageVersion.siteId, input.siteId),
          inArray(
            pageVersion.path,
            pages.map((p) => p.path),
          ),
        ),
      )
      .orderBy(desc(pageVersion.publishedAt));

    const latestByPath = new Map<string, string>();
    for (const row of latest) {
      if (!latestByPath.has(row.path)) latestByPath.set(row.path, row.contentSha);
    }

    const rows = pages
      .filter((p) => isNewVersion({ content: p.content, latestSha: latestByPath.get(p.path) ?? null }))
      .map((p) => ({
        id: randomUUID(),
        siteId: input.siteId,
        path: p.path,
        // Stored only when the bytes live nowhere else. A Git site's content is in the repo.
        content: input.commitSha ? null : p.content,
        contentSha: contentSha(p.content),
        commitSha: input.commitSha ?? null,
        authorUserId: input.actorUserId,
        deploymentId: input.deploymentId,
      }));

    if (rows.length === 0) return 0;
    await db.insert(pageVersion).values(rows);
    await Promise.all(rows.map((r) => prunePage(input.siteId, r.path)));
    return rows.length;
  } catch (err) {
    console.warn("[page-history] failed to record versions:", err);
    return 0;
  }
}

/** Keep the newest VERSIONS_PER_PAGE for one page; drop the rest. */
async function prunePage(siteId: string, path: string): Promise<void> {
  const keep = await db
    .select({ publishedAt: pageVersion.publishedAt })
    .from(pageVersion)
    .where(and(eq(pageVersion.siteId, siteId), eq(pageVersion.path, path)))
    .orderBy(desc(pageVersion.publishedAt))
    .limit(VERSIONS_PER_PAGE);

  const oldest = keep[keep.length - 1];
  if (keep.length < VERSIONS_PER_PAGE || !oldest) return;
  await db
    .delete(pageVersion)
    .where(
      and(
        eq(pageVersion.siteId, siteId),
        eq(pageVersion.path, path),
        lt(pageVersion.publishedAt, oldest.publishedAt),
      ),
    );
}

/** The panel's list: newest first, with the author's name for the row. */
export async function listPageVersions(siteId: string, path: string): Promise<VersionRow[]> {
  const rows = await db
    .select({
      id: pageVersion.id,
      publishedAt: pageVersion.publishedAt,
      authorName: user.name,
    })
    .from(pageVersion)
    .leftJoin(user, eq(pageVersion.authorUserId, user.id))
    .where(and(eq(pageVersion.siteId, siteId), eq(pageVersion.path, path)))
    .orderBy(desc(pageVersion.publishedAt))
    .limit(VERSIONS_PER_PAGE);

  // The first row IS the current published state — it's the most recent publish of this page.
  return rows.map((r, i) => ({ ...r, isCurrent: i === 0 }));
}

/**
 * One version's content.
 *
 * For a Papervine-hosted site it's stored. For a Git-backed site it isn't: the row carries a
 * commit sha and the bytes come from the repo, which is also why this can return null — a token
 * that has expired or a repo that has been disconnected is a real state, not an error worth
 * throwing at a panel.
 */
export async function getPageVersionContent(
  siteId: string,
  versionId: string,
): Promise<{ content: string; publishedAt: Date } | null> {
  const [row] = await db
    .select()
    .from(pageVersion)
    .where(and(eq(pageVersion.id, versionId), eq(pageVersion.siteId, siteId)))
    .limit(1);
  if (!row) return null;
  if (row.content !== null) return { content: row.content, publishedAt: row.publishedAt };

  const [site] = await db.select().from(siteTable).where(eq(siteTable.id, siteId)).limit(1);
  if (!site?.repoOwner || !site.repoName || !row.commitSha) return null;

  // The one place that turns a site's stored credentials into a token — App installation first,
  // then a stored PAT. Reimplementing that precedence here would drift from sync.
  const { repoTokenForSite } = await import("./github-token");
  const token = await repoTokenForSite(site).catch(() => undefined);
  if (!token) return null;

  const prefix = site.docsPath ? `${site.docsPath.replace(/^\/+|\/+$/g, "")}/` : "";
  const url = `https://api.github.com/repos/${site.repoOwner}/${site.repoName}/contents/${prefix}${row.path}?ref=${row.commitSha}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github.raw" },
  }).catch(() => null);
  if (!res?.ok) return null;
  return { content: await res.text(), publishedAt: row.publishedAt };
}
