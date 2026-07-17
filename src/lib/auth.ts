import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import { isReservedOrgSlug } from "./slug";
import { resolvePlatformRole } from "./platform-admin";

// Better Auth rejects any request whose Origin isn't trusted (CSRF protection →
// "Invalid origin"). The control plane (signup/login/dashboard) serves on the app host
// `app.papervine.io` (SPEC §10) — covered by the `*.papervine.io` wildcard; the apex
// entry stays for the marketing host. BETTER_AUTH_URL adds this deploy's own origin
// too — covering Vercel preview URLs.
//
// Dev trusts localhost on ANY port: `next dev` auto-picks 3001/3002… when :3000 is busy
// (multiple worktrees coexist by design), and a hardcoded `app.localhost:3000` entry
// 403'd every other port's sign-in ("Invalid origin") — which forced a per-worktree
// BETTER_AUTH_URL edit. In these patterns `*` matches any characters except `/`, so
// `http://*.localhost:*` covers the app host and every tenant subdomain on every port
// (see better-auth's matchesOriginPattern). Gated to non-production builds so the
// wildcards never ship: NODE_ENV is "development" under `next dev` (and the e2e/smoke
// servers), "production" on Vercel.
const trustedOrigins = [
  "https://papervine.io",
  "https://*.papervine.io",
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
  ...(process.env.NODE_ENV !== "production"
    ? ["http://localhost:*", "http://*.localhost:*", "http://127.0.0.1:*"]
    : []),
];

// Layer 1 — platform auth (SPEC §10.1). Email/password first; the organization
// plugin gives us tenants/teams/roles. nextCookies() must be last so cookies set
// during server actions are forwarded correctly.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  trustedOrigins,
  databaseHooks: {
    session: {
      create: {
        // Sync `user.role` from the PLATFORM_ADMIN_EMAILS allowlist at every sign-in
        // (SPEC §10.10). The env var is the source of truth for platform admins; the
        // role column only exists so the admin plugin below authorizes impersonation.
        // Crucially this REVOKES too — an email removed from the allowlist loses the
        // plugin's endpoints at their next session, not never.
        before: async (session) => {
          const [u] = await db
            .select({ email: schema.user.email, role: schema.user.role })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);
          const next = resolvePlatformRole(
            u?.email,
            process.env.PLATFORM_ADMIN_EMAILS,
            u?.role,
          );
          if (next) {
            await db
              .update(schema.user)
              .set({ role: next })
              .where(eq(schema.user.id, session.userId));
          }
        },
      },
    },
  },
  plugins: [
    // Impersonation for platform admins (SPEC §10.10): "log in as this customer" from
    // /admin, to see exactly what they see. Authorized by user.role === "admin", which
    // is only ever a synced mirror of the allowlist (databaseHooks above). Sessions the
    // plugin mints carry impersonatedBy → the persistent banner in the dashboard shell.
    admin({ impersonationSessionDuration: 60 * 60 }),
    organization({
      // Org slugs are app-host path segments (/:org). Refuse the handful that collide
      // with static control-plane routes — /admin (SPEC §10.10), /preview, the auth
      // pages — which would otherwise shadow the new org's dashboard 404-style. See
      // RESERVED_ORG_SLUGS in src/lib/slug.ts.
      organizationHooks: {
        beforeCreateOrganization: async ({ organization: org }) => {
          if (org.slug && isReservedOrgSlug(org.slug)) {
            throw new APIError("BAD_REQUEST", {
              message: `"${org.slug}" is reserved — pick a different name.`,
            });
          }
        },
        // Every new org starts on the 30-day all-features trial with its one-time
        // credit grant (SPEC §10 Billing). startTrial is idempotent and swallows its
        // own failures — a billing hiccup must never block workspace creation (the
        // org just resolves to Free until support intervenes).
        afterCreateOrganization: async ({ organization: org }) => {
          const { startTrial } = await import("@/lib/billing/store");
          await startTrial(org.id);
        },
      },
      // Invitation delivery seam (SPEC §10). v1 has NO email infra — the Members settings
      // action surfaces a shareable accept link directly (Copy-link UI), so a real send isn't
      // required to invite. This callback just records the link server-side; it's the single
      // place a real provider (e.g. Resend) slots in later — send `acceptUrl` to `data.email`
      // with `data.inviter`/`data.organization` for the template. No throw → never blocks the
      // createInvitation the action awaits.
      sendInvitationEmail: async (data) => {
        const origin = process.env.BETTER_AUTH_URL ?? "https://app.papervine.io";
        const acceptUrl = `${origin}/accept-invite?id=${data.id}`;
        console.log(
          `[invite] ${data.email} → ${data.organization.name} (${data.role}) — ${acceptUrl}`,
        );
      },
    }),
    nextCookies(),
  ],
});
