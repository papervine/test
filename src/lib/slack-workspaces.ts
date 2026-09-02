import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { slackWorkspace } from "./db/app-schema";
import { encryptSecret, decryptSecret } from "./crypto";
import type { SlackInstallResult } from "./slack";

/**
 * The org ↔ Slack workspace link (SPEC §10.2). Same discipline as
 * github-installations.ts: upsert keyed on the provider's unique id (team id), because
 * an install can be re-run (rotating the bot token) or a workspace re-pointed at a
 * different org — refresh the row rather than duplicate it.
 */

export type SlackWorkspaceRow = typeof slackWorkspace.$inferSelect;

export async function recordSlackInstall(
  organizationId: string,
  install: SlackInstallResult,
  installedByUserId?: string,
): Promise<void> {
  const botTokenEnc = encryptSecret(install.botToken);
  const existing = await db
    .select()
    .from(slackWorkspace)
    .where(eq(slackWorkspace.teamId, install.teamId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(slackWorkspace)
      .set({
        organizationId,
        teamName: install.teamName,
        botUserId: install.botUserId,
        botTokenEnc,
        scopes: install.scopes,
        installedByUserId: installedByUserId ?? existing[0].installedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(slackWorkspace.teamId, install.teamId));
    return;
  }
  await db.insert(slackWorkspace).values({
    id: randomUUID(),
    organizationId,
    teamId: install.teamId,
    teamName: install.teamName,
    botUserId: install.botUserId,
    botTokenEnc,
    scopes: install.scopes,
    installedByUserId: installedByUserId ?? null,
  });
}

export async function getSlackWorkspaceForOrg(
  organizationId: string,
): Promise<SlackWorkspaceRow | null> {
  const rows = await db
    .select()
    .from(slackWorkspace)
    .where(eq(slackWorkspace.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSlackWorkspaceByTeamId(
  teamId: string,
): Promise<SlackWorkspaceRow | null> {
  const rows = await db
    .select()
    .from(slackWorkspace)
    .where(eq(slackWorkspace.teamId, teamId))
    .limit(1);
  return rows[0] ?? null;
}

/** The live xoxb token for a stored workspace — the `repoTokenForSite` analogue: the
 * single choke point that turns the stored credential into something callable. */
export function botTokenFor(row: SlackWorkspaceRow): string {
  return decryptSecret(row.botTokenEnc);
}

/**
 * Disconnect = delete the row. The bot token dies with it (we don't call
 * auth.revoke — the workspace admin can also remove the app from Slack's side, and
 * either action alone must be enough to stop the agent, which resolving org-by-teamId
 * through this table guarantees).
 */
export async function disconnectSlackWorkspace(organizationId: string): Promise<void> {
  await db.delete(slackWorkspace).where(eq(slackWorkspace.organizationId, organizationId));
}
