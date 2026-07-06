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
// entry stays for the marketing host. In dev the control plane is `app.localhost:3000`,
// which no wildcard above matches, so it needs its own entry. BETTER_AUTH_URL adds this
// deploy's own origin too — covering Vercel preview URLs.
const trustedOrigins = [
  "https://papervine.io",
  "https://*.papervine.io",
  "http://app.localhost:3000",
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
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
