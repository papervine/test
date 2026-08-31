import "server-only";
import { and, eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { organization, member } from "./db/schema";
import { site } from "./db/app-schema";
import type { SiteRow } from "./dashboard-context";
import { canSeeFeature } from "./features";
import { getSession } from "./session";

/**
 * Who is allowed to write through the authoring MCP, and to which site (SPEC §9.2/§11).
 *
 * This exists because the authoring MCP has TWO kinds of caller and they authenticate
 * differently, while the authorization question is identical for both:
 *
 *   - an **MCP client** (Cursor, Claude), holding an OAuth 2.1 access token from the `mcp`
 *     plugin — the reason this module exists at all;
 *   - a **browser** on the app host, holding the dashboard session cookie.
 *
 * The cookie-bound helpers (`findSite`, `listOrganizations`) can't serve the first: they read
 * the current request's cookies, so a token-bearing request resolves to "signed out" no matter
 * how valid its token is. Everything here is keyed on an explicit `userId` instead, which is
 * also the stricter shape — membership is looked up per user rather than inherited from
 * whatever session the request happened to carry.
 */

/** Why a request may not write. Distinct cases because the messages have to differ. */
export type AuthoringDenial =
  | "unauthenticated"
  | "no-target"
  | "not-a-member"
  | "insufficient-role"
  | "no-such-site";

export type AuthoringTarget = {
  userId: string;
  site: SiteRow;
  role: string;
};

/**
 * The pure half: given what was resolved, may this request write?
 *
 * Separated from the lookups so the rules are testable without a database — and so the
 * order of the checks is visible in one place. Order matters for the message a caller gets:
 * "sign in" before "you're not a member" before "your role can't", because answering the
 * later question first tells an anonymous caller which orgs and sites exist.
 */
export function authoringDecision(input: {
  userId: string | null;
  orgSlug: string | null;
  siteSlug: string | null;
  isMember: boolean;
  role: string | null;
  siteExists: boolean;
}): { ok: true } | { ok: false; denial: AuthoringDenial } {
  if (!input.userId) return { ok: false, denial: "unauthenticated" };
  if (!input.orgSlug || !input.siteSlug) return { ok: false, denial: "no-target" };
  if (!input.isMember) return { ok: false, denial: "not-a-member" };
  if (!canSeeFeature("editor.workspace", input.role)) {
    return { ok: false, denial: "insufficient-role" };
  }
  if (!input.siteExists) return { ok: false, denial: "no-such-site" };
  return { ok: true };
}

/** What to tell the caller. Deliberately actionable: each names the next step. */
export function denialMessage(denial: AuthoringDenial): string {
  switch (denial) {
    case "unauthenticated":
      return "Not authenticated. Authorize this client (OAuth) or sign in to the dashboard.";
    case "no-target":
      return "No target site. Set the x-papervine-org and x-papervine-site headers.";
    case "not-a-member":
      // Same answer for "the org doesn't exist" and "you're not in it" — telling a
      // non-member which is which turns this endpoint into an org-slug oracle.
      return "No such organization, or you are not a member of it.";
    case "insufficient-role":
      return "Your role in this organization cannot edit docs.";
    case "no-such-site":
      return "No such site in this organization.";
  }
}

/**
 * Resolve the acting user from either credential.
 *
 * The OAuth token wins when both are present: a request that bothered to send a bearer token
 * is asking to act as that grant, and silently preferring an ambient cookie would let a
 * browser-side flow act with more authority than the token it presented.
 */
export async function resolveActorUserId(headers: Headers): Promise<string | null> {
  // `getMcpSession` returns null for a missing/expired token, but throws for a malformed
  // Authorization header — which must read as "not signed in", not as a 500.
  const token = await auth.api.getMcpSession({ headers }).catch(() => null);
  if (token?.userId) return token.userId;

  const session = await getSession();
  return session?.user.id ?? null;
}

/**
 * Full resolution: actor + org membership + feature gate + site row.
 *
 * Returns the denial rather than throwing, because every caller here is a protocol handler
 * that has to turn it into a message rather than a stack trace.
 */
export async function resolveAuthoringTarget(input: {
  userId: string | null;
  orgSlug: string | null;
  siteSlug: string | null;
}): Promise<{ ok: true; target: AuthoringTarget } | { ok: false; denial: AuthoringDenial }> {
  const { userId, orgSlug, siteSlug } = input;

  // Short-circuit before touching the database: an unauthenticated or targetless request
  // shouldn't cost a query, and this is an unauthenticated-reachable endpoint.
  const early = authoringDecision({
    userId,
    orgSlug,
    siteSlug,
    isMember: true,
    role: "owner",
    siteExists: true,
  });
  if (!early.ok) return { ok: false, denial: early.denial };

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, orgSlug!))
    .limit(1);

  const [membership] = org
    ? await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, org.id), eq(member.userId, userId!)))
        .limit(1)
    : [];

  const [row] =
    org && membership
      ? await db
          .select()
          .from(site)
          .where(and(eq(site.organizationId, org.id), eq(site.slug, siteSlug!)))
          .limit(1)
      : [];

  const decision = authoringDecision({
    userId,
    orgSlug,
    siteSlug,
    isMember: Boolean(org && membership),
    role: membership?.role ?? null,
    siteExists: Boolean(row),
  });
  if (!decision.ok) return { ok: false, denial: decision.denial };

  return { ok: true, target: { userId: userId!, site: row!, role: membership!.role } };
}
