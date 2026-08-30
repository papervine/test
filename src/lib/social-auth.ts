// Social sign-in for the platform account (SPEC §10.1) — pure + dependency-free so it
// unit-tests in isolation and is safe to read from both the Better Auth server config and
// the auth pages' server components.
//
// Every provider here is OPTIONAL: with no credentials in the environment the provider is
// simply absent from the auth config and its button never renders, so a bare checkout, CI,
// and the zero-dep smoke gate all work without any OAuth setup.

export type SocialProviderId = "google" | "github";

export type SocialProviderConfig = {
  clientId: string;
  clientSecret: string;
  /** The exact URI registered with the provider — see `oauthCallbackURI`. */
  redirectURI: string;
};

export type SocialProviderStatus =
  | { enabled: true; config: SocialProviderConfig }
  // "unconfigured" is the normal off state (no credentials). "missing-base-url" means
  // someone DID supply credentials but there's no origin to build a redirect URI from —
  // a misconfiguration worth warning about rather than silently ignoring.
  | { enabled: false; reason: "unconfigured" | "missing-base-url" };

/**
 * Where a provider sends the browser back after consent.
 *
 * This is deliberately built on the **apex** origin (`BETTER_AUTH_URL`), not the app host
 * the control plane actually serves on — the middleware forwards `/api/auth/callback/*`
 * from the apex to the app host, the same way it already forwards `/login` and `/signup`.
 * The reason is Google: it refuses to register a redirect URI on a subdomain of localhost
 * ("Invalid Redirect: must end with a public top-level domain"), so `http://app.localhost:3000/…`
 * can't be an authorized URI and local dev would have no way to test the flow. Routing the
 * callback through the apex in EVERY environment keeps one URI to register and one code
 * path — rather than a dev-only detour that never runs in production.
 */
export function oauthCallbackURI(baseUrl: string, provider: SocialProviderId): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/api/auth/callback/${provider}`;
}

/**
 * Resolve Google sign-in from raw env values (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
 * `BETTER_AUTH_URL`). Both halves of the credential are required — a client id without its
 * secret is a half-finished setup, not an enabled provider — and so is an origin to build
 * the redirect URI from. Takes the values rather than `process.env` so it stays pure.
 */
export function googleOAuthStatus(
  rawClientId: string | undefined,
  rawClientSecret: string | undefined,
  rawBaseUrl: string | undefined,
): SocialProviderStatus {
  return providerStatus("google", rawClientId, rawClientSecret, rawBaseUrl);
}

/**
 * GitHub sign-in, from the GitHub APP's user-OAuth credentials — the same
 * `GITHUB_APP_CLIENT_ID`/`SECRET` that power one-click repo creation (github-user-auth.ts).
 * GitHub's own guidance prefers a GitHub App's user authorization over a legacy OAuth app,
 * and reusing it keeps one credential and one consent screen. Two things live on the App's
 * settings page rather than in code: the apex callback URI below must be added as a Callback
 * URL, and the App needs **Account permissions → Email addresses: Read-only** — GitHub Apps
 * ignore OAuth scopes, so without that permission the callback returns no email and sign-in
 * fails. See docs/auth/github-sign-in.
 */
export function githubOAuthStatus(
  rawClientId: string | undefined,
  rawClientSecret: string | undefined,
  rawBaseUrl: string | undefined,
): SocialProviderStatus {
  return providerStatus("github", rawClientId, rawClientSecret, rawBaseUrl);
}

function providerStatus(
  provider: SocialProviderId,
  rawClientId: string | undefined,
  rawClientSecret: string | undefined,
  rawBaseUrl: string | undefined,
): SocialProviderStatus {
  const clientId = rawClientId?.trim();
  const clientSecret = rawClientSecret?.trim();
  if (!clientId || !clientSecret) return { enabled: false, reason: "unconfigured" };
  const baseUrl = rawBaseUrl?.trim();
  if (!baseUrl) return { enabled: false, reason: "missing-base-url" };
  return {
    enabled: true,
    config: { clientId, clientSecret, redirectURI: oauthCallbackURI(baseUrl, provider) },
  };
}

/** The `googleOAuthStatus` call every server call site makes — env in one place. */
export function googleOAuthFromEnv(): SocialProviderStatus {
  return googleOAuthStatus(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.BETTER_AUTH_URL,
  );
}

/** Same, for GitHub — reading the GitHub App's user-OAuth credential. */
export function githubOAuthFromEnv(): SocialProviderStatus {
  return githubOAuthStatus(
    process.env.GITHUB_APP_CLIENT_ID,
    process.env.GITHUB_APP_CLIENT_SECRET,
    process.env.BETTER_AUTH_URL,
  );
}

/** Is a provider's callback path one the apex should forward to the app host? */
export function isOAuthCallbackPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/callback/");
}

// Better Auth redirects a failed OAuth callback to our `errorCallbackURL` with a
// machine-readable `?error=` code. Translate the handful we can act on into plain English;
// anything else falls back to the generic message rather than leaking a raw code.
//
// `account_not_linked` is the one users actually hit: an email/password account already
// owns that address. Papervine has no email-verification flow yet, so Better Auth's default
// (link only onto a locally VERIFIED email) can't be satisfied — and loosening it would let
// anyone pre-register a victim's address with a password and inherit their social account on
// first sign-in. So we keep the safe default and explain the situation instead. See SPEC §10.1.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  account_not_linked:
    "That email already has a Papervine account with a password. Sign in with your password instead.",
  signup_disabled: "Sign-ups are closed for this deployment.",
};

export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  // Provider-neutral on purpose: the error lands back on the form as a bare `?error=` code,
  // with nothing saying which button was pressed.
  return OAUTH_ERROR_MESSAGES[code] ?? "Sign-in didn't complete. Please try again.";
}
