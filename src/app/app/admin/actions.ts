"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { site } from "@/lib/db/app-schema";
import { enqueueSkillGeneration } from "@/lib/skill-generate";
import { getSession } from "@/lib/session";
import { isPlatformAdminEmail } from "@/lib/platform-admin";

type ImpersonateResult = { ok: true; redirectTo: string } | { ok: false; error: string };

// Start impersonating a customer (SPEC §10.10): mints a session for `userId` with
// impersonatedBy = the caller, so the dashboard banner can offer "Stop". Authorization
// is the env allowlist — checked here, live — NOT the role column, which we only
// grant-sync below because the Better Auth endpoint authorizes by user.role (the
// revoke direction runs at session creation in src/lib/auth.ts, so a removed email
// loses this at next sign-in). Returns a target instead of redirect()ing: landing on
// the customer's dashboard is a bare app-host URL (Host-rewrite), so the client must
// hard-navigate — see the tenant-host redirect gotcha in CLAUDE.md.
export async function impersonateUser(userId: string): Promise<ImpersonateResult> {
  const session = await getSession();
  if (
    !session ||
    !isPlatformAdminEmail(session.user.email, process.env.PLATFORM_ADMIN_EMAILS)
  ) {
    return { ok: false, error: "Not authorized" };
  }
  if (userId === session.user.id) {
    return { ok: false, error: "You're already signed in as yourself" };
  }

  // Grant-sync so an allowlist edit works without re-login (the plugin reads the row).
  if (session.user.role !== "admin") {
    await db.update(user).set({ role: "admin" }).where(eq(user.id, session.user.id));
  }

  try {
    await auth.api.impersonateUser({
      body: { userId },
      headers: await headers(),
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof APIError ? e.message : "Impersonation failed",
    };
  }
  return { ok: true, redirectTo: "/" };
}

type RegenerateResult = { ok: true; queued: boolean } | { ok: false; error: string };

/**
 * Force a `skill.md` regeneration for one site (SPEC §9.1).
 *
 * `force` is the whole point: the hourly sweep deliberately skips a site whose capability
 * fingerprint hasn't moved, which is right for a background job and useless when an operator is
 * looking at a bad generation and wants it done again. Without this the only way to re-run one
 * was to null `skill_fingerprint` by hand in SQL.
 *
 * Authorized the same way as impersonation: the env allowlist, checked live, not a role column.
 * The layout already gates the console, but a server action isn't reached through the layout —
 * it's a POST to an endpoint, so it does its own check.
 */
export async function regenerateSkill(siteId: string): Promise<RegenerateResult> {
  const session = await getSession();
  if (
    !session ||
    !isPlatformAdminEmail(session.user.email, process.env.PLATFORM_ADMIN_EMAILS)
  ) {
    return { ok: false, error: "Not authorized" };
  }

  const [row] = await db.select().from(site).where(eq(site.id, siteId)).limit(1);
  if (!row) return { ok: false, error: "Site not found" };

  try {
    const queued = await enqueueSkillGeneration(row, { force: true });
    return { ok: true, queued };
  } catch (err) {
    console.error("[admin] skill regeneration failed", err);
    return { ok: false, error: "Could not start the regeneration" };
  }
}
