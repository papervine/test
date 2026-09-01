import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { deployment } from "@/lib/db/app-schema";
import type { ActivityRow, FeedTarget } from "@/lib/overview";

// The Activity feed's data fetch (SPEC §10.3), shared by the server-rendered Overview and
// the bare `/:org/:site/activity` polling endpoint that drives it live — one query so the
// initial paint and every poll agree. `createdAt` is mapped to epoch ms here so the row is
// JSON-safe for transport (the client recomputes "x ago" off it).
export async function getActivityFeed(
  siteId: string,
  target: FeedTarget,
): Promise<ActivityRow[]> {
  const rows = await db
    .select({
      id: deployment.id,
      status: deployment.status,
      commitMessage: deployment.commitMessage,
      commitSha: deployment.commitSha,
      error: deployment.error,
      filesAdded: deployment.filesAdded,
      filesEdited: deployment.filesEdited,
      trigger: deployment.trigger,
      revisionId: deployment.revisionId,
      durationMs: deployment.durationMs,
      createdAt: deployment.createdAt,
      actorName: user.name,
    })
    .from(deployment)
    .leftJoin(user, eq(deployment.actorUserId, user.id))
    .where(and(eq(deployment.siteId, siteId), eq(deployment.target, target)))
    .orderBy(desc(deployment.createdAt))
    .limit(20);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
}
