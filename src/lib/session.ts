import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { member } from "./db/schema";

// Server-side session read for RSC layouts/pages. Returns null when signed out.
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// Organizations the current request's user belongs to (tenants).
export async function listOrganizations() {
  return auth.api.listOrganizations({ headers: await headers() });
}

// This user's role in a given org (owner | admin | member), or null if they aren't a
// member. Queried straight from the membership table rather than Better Auth's
// activeMember API because the layout picks the active org itself (first org), which may
// not match the session's activeOrganizationId. Feeds feature gating (src/lib/features.ts).
export async function getMemberRole(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    )
    .limit(1);
  return rows[0]?.role ?? null;
}
