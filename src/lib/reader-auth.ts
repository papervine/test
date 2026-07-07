// Layer 2 — Reader auth (SPEC §11.2). The customer's *readers* sign in with the
// customer's own identity system; we only verify a signed assertion and mint a short
// docs session. This module is the config layer the dashboard edits — pure types,
// validation, and labels. The actual handshake/enforcement (middleware) is the v2
// follow-up; keeping the config shape here lets both the settings UI and the future
// verifier share one source of truth.
//
// Build order matches the spec: JWT first (simplest), then OAuth 2.0, then Password.

export const AUTH_METHODS = ["jwt", "oauth", "password"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

// Where the customer's backend sends the browser after signing the reader JWT (token in the
// URL hash). Lives here (not the server-only reader-jwt.ts) so the client dashboard form and
// the verifier can both reference one source of truth without importing a server module.
export const JWT_CALLBACK_PATH = "/login/jwt-callback";

export function isAuthMethod(value: unknown): value is AuthMethod {
  return typeof value === "string" && (AUTH_METHODS as readonly string[]).includes(value);
}

// Human-facing copy for the method picker — mirrors hosted docs platforms' settings surface.
export const AUTH_METHOD_META: Record<
  AuthMethod,
  { label: string; tagline: string }
> = {
  jwt: {
    label: "JWT",
    tagline:
      "Your backend signs a token after the user logs into your app, then redirects to the docs.",
  },
  oauth: {
    label: "OAuth 2.0",
    tagline:
      "Run the standard auth-code + PKCE flow against your existing OAuth/OIDC server.",
  },
  password: {
    label: "Password",
    tagline: "A single shared password — the cheapest way to gate a docs site.",
  },
};

// Non-secret, method-specific config persisted as JSON. The method's one secret (JWT
// signing secret / OAuth client secret / the password itself) is stored separately and
// encrypted — never in here. Fields are a flat union so the column stays a simple blob.
export type ReaderAuthConfig = {
  // JWT: where to send an unauthenticated reader to sign in. Their app signs a JWT and
  // redirects back to /login/jwt-callback#{token}.
  loginUrl?: string;
  // JWT: the Ed25519 *public* key (SPKI PEM) we verify reader tokens with. Non-secret, so
  // it lives here rather than in authSecretEnc (which holds the encrypted private key). The
  // dashboard generates the keypair; this is set alongside the private key and preserved
  // when the loginUrl is edited.
  publicKey?: string;
  // OAuth 2.0 endpoints + public client id and scopes.
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  clientId?: string;
  scopes?: string;
};

export type ValidationResult =
  | { ok: true; config: ReaderAuthConfig; secret: string | null }
  | { ok: false; error: string };

// https URLs only — these are browser redirects / server-to-server calls in production,
// and a plain-http login endpoint would leak the handoff. Empty string is "not set".
function checkHttpsUrl(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return `${label} is required.`;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return `${label} must be a valid URL.`;
  }
  if (url.protocol !== "https:") return `${label} must use https://.`;
  return null;
}

/**
 * Validate the form payload for a method and return the normalized non-secret config plus
 * the secret to persist. Pure (no I/O) so it unit-tests cleanly. `secret` is returned
 * separately because the caller encrypts it before storage. A null secret means "leave the
 * stored secret unchanged" (the form sends "" only when the user explicitly clears it).
 */
export function validateAuthConfig(
  method: AuthMethod,
  input: {
    loginUrl?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    clientId?: string;
    scopes?: string;
    secret?: string;
  },
): ValidationResult {
  const secret = input.secret?.trim() ?? "";

  if (method === "jwt") {
    const err = checkHttpsUrl(input.loginUrl ?? "", "Login URL");
    if (err) return { ok: false, error: err };
    return {
      ok: true,
      config: { loginUrl: (input.loginUrl ?? "").trim() },
      // A JWT signing secret is minted server-side, so "" here just means "keep current".
      secret: secret === "" ? null : secret,
    };
  }

  if (method === "oauth") {
    for (const [value, label] of [
      [input.authorizationUrl ?? "", "Authorization URL"],
      [input.tokenUrl ?? "", "Token URL"],
      [input.userInfoUrl ?? "", "User info URL"],
    ] as const) {
      const err = checkHttpsUrl(value, label);
      if (err) return { ok: false, error: err };
    }
    if ((input.clientId ?? "").trim() === "")
      return { ok: false, error: "Client ID is required." };
    return {
      ok: true,
      config: {
        authorizationUrl: (input.authorizationUrl ?? "").trim(),
        tokenUrl: (input.tokenUrl ?? "").trim(),
        userInfoUrl: (input.userInfoUrl ?? "").trim(),
        clientId: (input.clientId ?? "").trim(),
        scopes: (input.scopes ?? "").trim() || undefined,
      },
      secret: secret === "" ? null : secret,
    };
  }

  // password
  if (secret.length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  return { ok: true, config: {}, secret };
}

/**
 * Build the customer's login URL with the intended docs path appended as `?redirect=`, so
 * their backend knows where to send the reader back after signing the JWT (it redirects to
 * `{DOCS_HOST}/login/jwt-callback?redirect=…#{JWT}`). Preserves any query the customer
 * already has on their login URL. Pure → unit-testable.
 */
export function customerLoginUrl(loginUrl: string, redirectPath: string): string {
  const url = new URL(loginUrl);
  url.searchParams.set("redirect", redirectPath);
  return url.toString();
}

/**
 * Per-page group access control (SPEC §11.2). A page with no `groups` (or `public: true`) is
 * open to any reader who cleared the site gate; a page with `groups` requires the reader to
 * be in **at least one** listed group. `readerGroups` comes from the auth handshake (the
 * password method has none, so it can never satisfy a `groups:` page — by design). Pure so it
 * unit-tests without a session; the caller turns a `false` into a 404 (not 403 — don't leak
 * that a protected page exists) and hides the page from the nav.
 */
export function canAccessPage(
  pageGroups: string[] | undefined,
  isPublic: boolean | undefined,
  readerGroups: readonly string[],
): boolean {
  if (isPublic) return true;
  if (!pageGroups || pageGroups.length === 0) return true;
  return pageGroups.some((g) => readerGroups.includes(g));
}

/**
 * Sanitize a `?redirect=` target before sending a reader there post-login. Only same-site
 * relative paths (a single leading "/") are allowed — this blocks open-redirects via a
 * crafted `//evil.com` or `https://evil.com` value. Anything else falls back to `fallback`.
 */
export function safeRedirect(
  target: string | undefined | null,
  fallback: string,
): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}
