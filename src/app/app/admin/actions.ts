"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
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
