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
import { googleOAuthFromEnv } from "./social-auth";
import { appOriginFor } from "./tenant-host";
import { sendEmail, emailStatusFromEnv } from "./email";
import {
  invitationBody,
  resetPasswordBody,
  verifyEmailBody,
} from "./email-templates";

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

// Google sign-in is optional: unset credentials → the provider is absent and the button
// never renders (src/lib/social-auth.ts). Credentials WITH no BETTER_AUTH_URL is a
// misconfiguration, not an off switch — there'd be no origin to build the redirect URI
// from — so say so loudly instead of silently disabling sign-in the operator asked for.
const google = googleOAuthFromEnv();
if (!google.enabled && google.reason === "missing-base-url") {
  console.warn(
    "[auth] GOOGLE_CLIENT_ID/SECRET are set but BETTER_AUTH_URL is not — Google sign-in stays off (no origin for the OAuth redirect URI).",
  );
}

// Every link we put in an email lands on the APP host, not the apex `BETTER_AUTH_URL`:
// verification and reset callbacks set session cookies, and those are host-only on `app.`
// (SPEC §10). Better Auth builds its own `url` from `baseURL` (the apex), so we ignore that
// argument and rebuild from the raw `token` — the endpoints are identical on either host.
const APP_ORIGIN = appOriginFor(process.env.BETTER_AUTH_URL ?? "");
if (!APP_ORIGIN) {
  console.warn(
    "[auth] BETTER_AUTH_URL is missing or unparseable — emailed verification/reset links can't be built.",
  );
}
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

const authLink = (path: string) => `${APP_ORIGIN}${path}`;

// Password reset and email verification are only *offered* when email can actually be sent —
// a "check your inbox" that goes nowhere is worse than no button at all. The auth pages read
// the same status to decide whether to show the "Forgot password?" link.
const emailEnabled = emailStatusFromEnv().enabled;
if (!emailEnabled) {
  console.warn(
    "[auth] no transactional email configured (RESEND_API_KEY/EMAIL_FROM) — verification and password-reset links are logged to this console instead of sent.",
  );
}

// Layer 1 — platform auth (SPEC §10.1). Email/password first; the organization
// plugin gives us tenants/teams/roles. nextCookies() must be last so cookies set
// during server actions are forwarded correctly.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    // Rebuilt on the app host (see APP_ORIGIN). `?callbackURL=` is where Better Auth sends the
    // browser once it has validated the token — our own reset form, which then submits the
    // token with the new password.
    sendResetPassword: async ({ user, token }) => {
      if (!APP_ORIGIN) return;
      await sendEmail(
        user.email,
        resetPasswordBody({
          url: `${authLink(`/api/auth/reset-password/${token}`)}?callbackURL=${encodeURIComponent(
            authLink("/reset-password"),
          )}`,
          name: user.name,
          expiresInMinutes: RESET_TOKEN_TTL_SECONDS / 60,
        }),
      );
    },
    // Someone resetting a password is very often someone who thinks they were compromised.
    // Cutting every other session is the behavior that makes the reset actually mean something.
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    // Send on signup, but DON'T gate sign-in on it (`requireEmailVerification` stays off).
    // Every account created before this shipped has `emailVerified: false`, and flipping the
    // gate would lock out the entire existing user base at once. Verification's job here is to
    // unlock Google account linking (§11.1) and to make password reset trustworthy — not to
    // stand between a new signup and their dashboard.
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, token }) => {
      if (!APP_ORIGIN) return;
      await sendEmail(
        user.email,
        verifyEmailBody({
          url: `${authLink("/api/auth/verify-email")}?token=${token}&callbackURL=${encodeURIComponent(
            authLink("/"),
          )}`,
          name: user.name,
        }),
      );
    },
  },
  // The explicit `redirectURI` matters: Better Auth would otherwise derive it from
  // BETTER_AUTH_URL/the request, and the two disagree here — sign-in starts on the app
  // host while the URI registered with Google is the apex one (see oauthCallbackURI for
  // why). Account LINKING keeps Better Auth's secure default: a Google identity only folds
  // into an existing account whose local email is already verified. We have no verification
  // flow yet, so same-email collisions surface as a "sign in with your password" message
  // rather than silently merging — which would make pre-registering someone else's address
  // a working account-takeover.
  ...(google.enabled ? { socialProviders: { google: google.config } } : {}),
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
      // Invitation delivery (SPEC §10). Now a real send — but the Members settings action
      // still surfaces the shareable accept link in its Copy-link UI, deliberately: that path
      // predates email, works when delivery is unconfigured, and is the fallback when a send
      // silently lands in someone's spam. `sendEmail` never throws, so a provider outage can't
      // block the `createInvitation` the action awaits — the inviter just falls back to
      // copying the link.
      sendInvitationEmail: async (data) => {
        const acceptUrl = `${APP_ORIGIN ?? "https://app.papervine.io"}/accept-invite?id=${data.id}`;
        await sendEmail(
          data.email,
          invitationBody({
            url: acceptUrl,
            organization: data.organization.name,
            role: data.role,
            inviterName: data.inviter.user.name,
          }),
        );
      },
    }),
    nextCookies(),
  ],
});
