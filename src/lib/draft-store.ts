import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { editorSession, draftFile } from "@/lib/db/app-schema";

// Server-side draft buffer DB access (SPEC §9.2). An edit session is one working branch
// off the deploy branch; its draftFiles are the buffered, uncommitted edits. Both the
// web editor and the editing agent go through this module, so there is one source of
// truth. Paths are docs-root-relative (docsPath stripped), matching the S3 content keys —
// e.g. "guides/intro.mdx", "index.mdx", "docs.json".

export type EditorSessionRow = typeof editorSession.$inferSelect;
export type DraftFileRow = typeof draftFile.$inferSelect;

/** The open session for (site, branch), or null. One open session per branch (unique idx). */
export async function findOpenSession(
  siteId: string,
  branch: string,
): Promise<EditorSessionRow | null> {
  const rows = await db
    .select()
    .from(editorSession)
    .where(
      and(
        eq(editorSession.siteId, siteId),
        eq(editorSession.branch, branch),
        eq(editorSession.status, "open"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** All open sessions for a site (the branch switcher's list of working branches). */
export async function listOpenSessions(siteId: string): Promise<EditorSessionRow[]> {
  return db
    .select()
    .from(editorSession)
    .where(and(eq(editorSession.siteId, siteId), eq(editorSession.status, "open")));
}

export async function createSession(input: {
  siteId: string;
  branch: string;
  baseBranch: string;
  baseCommitSha: string | null;
  createdBy?: string | null;
}): Promise<EditorSessionRow> {
  try {
    const [row] = await db
      .insert(editorSession)
      .values({ id: randomUUID(), ...input })
      .returning();
    return row;
  } catch (err) {
    // Two concurrent checkouts can both see "no open session yet" and both try to create one —
    // the partial unique index (one open row per site+branch) lets exactly one insert win and
    // rejects the other with a duplicate-key error. Rather than 500 the loser, hand it the
    // winner's row: to the caller this looks identical to findOpenSession finding it first.
    if (isUniqueViolation(err, "editorSession_site_branch_idx")) {
      const existing = await findOpenSession(input.siteId, input.branch);
      if (existing) return existing;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    typeof err.cause === "object" &&
    err.cause !== null &&
    "code" in err.cause &&
    err.cause.code === "23505" &&
    "constraint_name" in err.cause &&
    err.cause.constraint_name === constraint
  );
}

/** Flip a session to 'published' or 'discarded'. Discard relies on FK cascade to drop drafts. */
export async function closeSession(
  sessionId: string,
  status: "published" | "discarded",
): Promise<void> {
  await db
    .update(editorSession)
    .set({ status, updatedAt: new Date() })
    .where(eq(editorSession.id, sessionId));
}

export async function getDraftFile(sessionId: string, path: string): Promise<DraftFileRow | null> {
  const rows = await db
    .select()
    .from(draftFile)
    .where(and(eq(draftFile.sessionId, sessionId), eq(draftFile.path, path)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDraftFiles(sessionId: string): Promise<DraftFileRow[]> {
  return db.select().from(draftFile).where(eq(draftFile.sessionId, sessionId));
}

/** Upsert a draft file (one row per path per session). Bumps the session's updatedAt so the
 *  branch switcher can sort by recency and the overview can show "edited just now". */
export async function upsertDraftFile(input: {
  sessionId: string;
  path: string;
  content: string;
  deleted?: boolean;
  /** An uploaded asset: the bytes live in object storage, `content` is empty. See media-upload.ts. */
  binary?: boolean;
}): Promise<void> {
  const { sessionId, path, content, deleted = false, binary = false } = input;
  await db
    .insert(draftFile)
    .values({ id: randomUUID(), sessionId, path, content, deleted, binary })
    .onConflictDoUpdate({
      target: [draftFile.sessionId, draftFile.path],
      set: { content, deleted, binary, updatedAt: new Date() },
    });
  await db
    .update(editorSession)
    .set({ updatedAt: new Date() })
    .where(eq(editorSession.id, sessionId));
}

/** Revert one file: drop its draft row so the base (synced) content shows through again. */
export async function deleteDraftFile(sessionId: string, path: string): Promise<void> {
  await db
    .delete(draftFile)
    .where(and(eq(draftFile.sessionId, sessionId), eq(draftFile.path, path)));
  await db
    .update(editorSession)
    .set({ updatedAt: new Date() })
    .where(eq(editorSession.id, sessionId));
}
