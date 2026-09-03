import { deploymentOrigin, isDevLike } from "@/lib/env";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
// `mcp` has no `better-auth/plugins/mcp` subpath export (only its client half does) — it
// comes off the barrel, unlike admin/organization which have both.
import {
  admin,
  bearer,
  deviceAuthorization,
  mcp,
  organization,
} from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";
import { isReservedOrgSlug } from "./slug";
import { resolvePlatformRole } from "./platform-admin";
import { githubOAuthFromEnv, googleOAuthFromEnv } from "./social-auth";
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
// entry stays for the marketing host. `deploymentOrigin()` adds this deploy's own origin
// too: BETTER_AUTH_URL where it's set, else the per-deployment VERCEL_URL — which is what
// makes a PREVIEW work, since its hostname is generated and no static value can name it
// (src/lib/env.ts).
//
// Dev trusts localhost on ANY port: `next dev` auto-picks 3001/3002… when :3000 is busy
// (multiple worktrees coexist by design), and a hardcoded `app.localhost:3000` entry
// 403'd every other port's sign-in ("Invalid origin") — which forced a per-worktree
// BETTER_AUTH_URL edit. In these patterns `*` matches any characters except `/`, so
// `http://*.localhost:*` covers the app host and every tenant subdomain on every port
// (see better-auth's matchesOriginPattern). Gated to dev-like runs so the wildcards never
// ship: NODE_ENV is "development" under `next dev` (and the smoke server), "production" on
// Vercel — and the e2e suite, which runs a production BUILD, opts back in with
// PAPERVINE_TEST_MODE (src/lib/env.ts).
const trustedOrigins = [
  "https://papervine.io",
  "https://*.papervine.io",
  ...(deploymentOrigin() ? [deploymentOrigin()!] : []),
  ...(isDevLike()
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
// GitHub sign-in rides on the GitHub APP's user-OAuth credential (the one that already powers
// one-click repo creation) — see githubOAuthStatus for the two App settings it needs.
const github = githubOAuthFromEnv();
if (!github.enabled && github.reason === "missing-base-url") {
  console.warn(
    "[auth] GITHUB_APP_CLIENT_ID/SECRET are set but BETTER_AUTH_URL is not — GitHub sign-in stays off (no origin for the OAuth redirect URI).",
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
  // host while the URI registered with the provider is the apex one (see oauthCallbackURI
  // for why). Account LINKING keeps Better Auth's secure default: a social identity only folds
  // into an existing account whose local email is already verified. We have no verification
  // flow yet, so same-email collisions surface as a "sign in with your password" message
  // rather than silently merging — which would make pre-registering someone else's address
  // a working account-takeover.
  ...(google.enabled || github.enabled
    ? {
        socialProviders: {
          ...(google.enabled ? { google: google.config } : {}),
          ...(github.enabled ? { github: github.config } : {}),
        },
      }
    : {}),
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
        afterCreateOrganization: async ({ organization: org, user }) => {
          const { startTrial } = await import("@/lib/billing/store");
          await startTrial(org.id, { name: org.name, email: user.email });
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
    // OAuth 2.1 for the authoring MCP (SPEC §9.2/§11). Until this, `/authoring/mcp`
    // authenticated by the dashboard session cookie alone — which no MCP client can send, so
    // the write surface was reachable only from a browser that was already signed in. That is
    // to say: not reachable at all, by the tools it exists for.
    //
    // A pasted personal access token would have been less code. It's the wrong shape: MCP
    // clients already implement the OAuth discovery + authorize dance (it's in the spec), so
    // the user's flow becomes "a browser tab opens, you approve, done" instead of "mint a
    // secret, paste it into a config file, and hope you remember to revoke it". Revocation and
    // expiry come with the grant rather than needing a surface of their own.
    //
    // `loginPage` is RELATIVE on purpose. The plugin redirects with it verbatim
    // (`ctx.redirect(loginPage + "?" + query)`), so a relative path resolves against whichever
    // host the authorize request arrived on — the app host in production, `app.localhost:<port>`
    // in dev. An absolute one built from `APP_ORIGIN` looked more careful and was worse: with
    // `BETTER_AUTH_URL` pinned to :3000, a dev server on :3001 sent the user to a *different
    // application* on :3000 mid-flow, and in production it breaks the moment the app host and
    // `BETTER_AUTH_URL` disagree.
    //
    // The login page resumes the authorization itself — see `postAuthDestFor`, which sends a
    // freshly signed-in user back to `/api/auth/mcp/authorize` with the query intact.
    mcp({
      loginPage: "/login",
      // Consent is FORCED — see src/app/api/auth/mcp/authorize/route.ts for why, and for the
      // wrapper that sets `prompt=consent` so a client can't decline to ask.
      // `loginPage` is repeated because OIDCOptions requires its own copy; it must match the
      // outer one or the two halves of the flow would send people to different pages.
      oidcConfig: { loginPage: "/login", consentPage: "/oauth/consent" },
    }),
    // OAuth 2.0 Device Authorization Grant (RFC 8628) — how `papervine signup` / `papervine
    // login` sign a terminal in, and the reason the CLI never handles a password (SPEC §11.4).
    // A client asks for a pair of codes, shows the human the short one, and polls
    // /api/auth/device/token until the /device page approves it.
    //
    // The sibling of the `mcp()` grant above, not a competitor: both are advertised by the one
    // discovery document (`src/lib/mcp-oauth-metadata.ts`), and they answer different questions.
    // Authorization-code + PKCE is right when the client can receive a redirect — an MCP client,
    // an editor extension. The device grant is right when it cannot: a terminal, a container, an
    // SSH session, a CI job.
    //
    // Two consequences of running it on THIS deployment, both load-bearing:
    //
    //  - `verificationUri` is on the APP host, not `BETTER_AUTH_URL`'s apex. Approving needs a
    //    session, and the session cookie is host-only on `app.` by design (SPEC §10) — a
    //    verification page on the apex would be permanently signed out. The `/api/auth/*`
    //    endpoints answer on either host (one route tree), so only the human-facing URL cares.
    //  - No `validateClient`. The device grant is for PUBLIC clients with no secret, and the
    //    point of advertising it in a public discovery document is that a client we have never
    //    heard of can use it. So any client_id is accepted and shown verbatim on the approval
    //    page — the human deciding IS the authorization, not an allowlist we would have to
    //    maintain. (A client that wants a *recorded* identity can register through the `mcp`
    //    plugin's RFC 7591 endpoint instead; that is the trade it buys.)
    deviceAuthorization({
      // Long enough to find the browser tab, sign up, maybe check email; short enough that a
      // code left on a shared terminal is worthless by the time anyone reads it.
      expiresIn: "15m",
      interval: "5s",
      ...(APP_ORIGIN ? { verificationUri: `${APP_ORIGIN}/device` } : {}),
      // Not a customization — a workaround. The plugin's options are typed `Partial<…>`, but
      // its runtime Zod schema declares `schema` WITHOUT `.optional()`, so omitting the key
      // throws a ZodError *at module evaluation*: `src/lib/auth.ts` fails to import, and every
      // page that touches auth 500s while the pages that don't render perfectly. `{}` is a
      // no-op through the plugin's `mergeSchema`. Remove when better-auth marks it optional.
      schema: {},
    }),
    // Accept `Authorization: Bearer <session token>` anywhere a session is read. This is what
    // makes the token the device grant hands back usable at all — the CLI has no cookie jar.
    //
    // Narrower than it looks, and deliberately so: this signs a raw SESSION token, which is what
    // `/device/token` returns. It is not the authoring MCP's credential — that is an OIDC access
    // token verified by `authoring-auth.ts`, which resolves its own actor and never reaches this
    // hook. So the two token types stay separate; `bearer()` exists for `/api/me` and whatever
    // the CLI reaches for next.
    bearer(),
    // Documented as last — it forwards cookies set during server actions.
    nextCookies(),
  ],
});
