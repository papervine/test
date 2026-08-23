import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { githubInstallation } from "./db/app-schema";
import { fetchInstallation } from "./github-app";

/**
 * Record a GitHub App installation against an org (SPEC §3).
 *
 * Extracted because **two** routes can receive an install: `/api/github/setup` (the App's
 * Setup URL) and `/api/github/user-auth/callback` (its Callback URL). GitHub picks one
 * depending on whether the App requests user authorization during installation, and with
 * that enabled it uses the Callback URL — so whichever arrives has to be able to store it,
 * or the App ends up installed on GitHub's side with nothing recorded here, which looks
 * exactly like the install silently not working.
 *
 * Upsert keyed on the unique installation_id: an install can be re-run or moved between
 * orgs, so the owning org and account label are refreshed rather than duplicated.
 */
export async function recordInstallation(
  organizationId: string,
  installationId: number,
): Promise<void> {
  const info = await fetchInstallation(installationId);
  const existing = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(githubInstallation)
      .set({
        organizationId,
        accountLogin: info?.accountLogin ?? existing[0].accountLogin,
        updatedAt: new Date(),
      })
      .where(eq(githubInstallation.installationId, installationId));
    return;
  }
  await db.insert(githubInstallation).values({
    id: randomUUID(),
    organizationId,
    installationId,
    accountLogin: info?.accountLogin ?? "",
  });
}
