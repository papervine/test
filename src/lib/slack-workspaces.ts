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

/**
 * The live xoxb token for a stored workspace — the `repoTokenForSite` analogue: the
 * single choke point that turns the stored credential into something callable.
 *
 * Returns **null** rather than throwing when the stored value can't be read.
 * `decryptSecret` throws on a bad envelope (or a missing key), and this is called from
 * the agent-run task *before* its try/catch — an unhandled throw there left the run row
 * stuck at `queued` forever, which reads to the user as a bot that silently ignored them.
 */
export function botTokenFor(row: SlackWorkspaceRow): string | null {
  try {
    return decryptSecret(row.botTokenEnc);
  } catch {
    return null;
  }
}

/**
 * Why `botTokenFor` came back null, as something an operator can act on.
 *
 * The two causes need *opposite* remedies, and conflating them sends people the wrong
 * way — this exists because the first live prod run said "reconnect the workspace" when
 * the truth was that the EXECUTOR had no encryption key. Reconnecting would have
 * re-encrypted the token with the web app's key and left the executor just as unable to
 * read it: a fix that cannot work, suggested confidently.
 *
 * - No key configured *here* → a deployment problem, and specifically a drift one: the
 *   executor runs in Trigger.dev's cloud and does NOT inherit Vercel's env (SPEC §10.2
 *   ops notes), so it needs `PAPERVINE_ENCRYPTION_KEY` set to the SAME value the web app
 *   encrypted with.
 * - Key present but the value won't decrypt → the stored bytes are unusable (the key was
 *   rotated after the token was stored, or the row is corrupt). Re-installing is then the
 *   real fix, because it re-encrypts with the current key.
 *
 * Takes the key EXPLICITLY rather than defaulting to `process.env` — a default parameter
 * would substitute the ambient value when a caller passes `undefined`, which is both
 * untestable and the same ambient-magic confusion this function exists to end.
 */
export function botTokenFailureReason(encryptionKey: string | undefined): string {
  return encryptionKey
    ? "the stored Slack bot token could not be decrypted — the encryption key changed since it was stored, so reconnect the workspace"
    : "this deployment's executor has no PAPERVINE_ENCRYPTION_KEY, so it cannot read stored credentials — set it in the executor's environment to the same value the web app uses (reconnecting will not help)";
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
