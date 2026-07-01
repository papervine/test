"use server";

import { cookies, headers } from "next/headers";
import { getSiteBySlug } from "@/lib/tenant";
import { decryptSecret } from "@/lib/crypto";
import { safeRedirect, type ReaderAuthConfig } from "@/lib/reader-auth";
import { verifyReaderJwt } from "@/lib/reader-jwt";
import {
  READER_COOKIE,
  READER_SESSION_TTL_S,
  mintReaderSession,
  passwordMatches,
} from "@/lib/reader-session";

export type ReaderLoginState = { ok?: boolean; error?: string; redirectTo?: string };

/**
 * DEV-ONLY: sign in as a test reader with chosen groups, no external IdP. A JWT/OAuth site has
 * no Papervine login form (it bounces to the customer's IdP), so there's no in-browser way to
 * exercise the gate + per-page `groups:` locally — `scripts/sign-reader-jwt.mjs` is the CLI
 * workaround. This mints the docs session directly with the given groups so you can verify RBAC
 * from the browser. **Hard-gated to non-production** (and the dev sign-in card only renders in
 * dev) — it forges a reader session, so it must never be reachable in prod.
 */
export async function devReaderSignIn(input: {
  slug: string;
  groups: string;
  redirectTo: string;
}): Promise<ReaderLoginState> {
  if (process.env.NODE_ENV === "production") {
    return { error: "Dev reader sign-in is disabled in production." };
  }
  const record = await getSiteBySlug(input.slug);
  if (!record?.authEnabled) return { error: "Authentication isn't enabled for this site." };
  const groups = input.groups
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  await setReaderCookie(mintReaderSession(record.id, Date.now(), { groups }));
  return { ok: true, redirectTo: safeRedirect(input.redirectTo, "/") };
}

// Set the site-bound, 7-day reader-session cookie. Shared by every handshake (password +
// JWT) so the cookie flags stay identical: httpOnly (JS can't read it), Secure in prod
// (browsers drop Secure over http://localhost), sameSite=lax, site-wide path.
async function setReaderCookie(value: string): Promise<void> {
  (await cookies()).set(READER_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: READER_SESSION_TTL_S,
  });
}

/**
 * Verify the shared docs password (SPEC §11.2, password method) and, on success, set the
 * reader-session cookie and return the sanitized destination. We deliberately DON'T
 * `redirect()` from here: the gated docs live on a tenant host that the middleware
 * resolves from the Host header, and a server-action redirect to "/" is followed as a
 * soft RSC navigation that skips that Host rewrite — so "/" resolves to the apex
 * marketing home instead of the tenant's docs. The client does a full-page navigation
 * to `redirectTo` instead (re-running middleware), which lands on the docs correctly.
 * Returns an error string (no throw) so the form can show it inline; the stored secret
 * never leaves the server — we decrypt it only to compare.
 */
export async function submitReaderPassword(input: {
  slug: string;
  password: string;
  redirectTo: string;
}): Promise<ReaderLoginState> {
  const record = await getSiteBySlug(input.slug);
  if (
    !record?.authEnabled ||
    record.authMethod !== "password" ||
    !record.authSecretEnc
  ) {
    return { error: "Password sign-in isn't enabled for this site." };
  }

  let actual: string;
  try {
    actual = decryptSecret(record.authSecretEnc);
  } catch {
    // The encryption key is missing/rotated — fail closed rather than letting anyone in.
    return { error: "This site's authentication is misconfigured. Contact the owner." };
  }

  // `authSecretEnc` is shared across methods and a method switch preserves it (so the JWT keypair
  // survives toggling — see settings/authentication/actions.ts). So a site switched to "password"
  // but never given one can still hold a leftover JWT private key here. That's not a password —
  // fail closed until the owner saves a real one, rather than accepting the PEM as the password.
  if (actual.startsWith("-----BEGIN")) {
    return { error: "Password sign-in isn't enabled for this site." };
  }

  if (!passwordMatches(input.password, actual)) {
    return { error: "Incorrect password." };
  }

  await setReaderCookie(mintReaderSession(record.id));

  // safeRedirect blocks an open-redirect via a crafted ?redirect= value.
  return { ok: true, redirectTo: safeRedirect(input.redirectTo, "/") };
}

// The JWT session can't outlive a sane ceiling even if the customer sets a huge `expiresAt`
// — keep it within the same 7-day window as the password method so a revoked reader loses
// access within a week at most.
const MAX_JWT_SESSION_MS = READER_SESSION_TTL_S * 1000;

/**
 * Complete the JWT handshake (SPEC §11.2, method 1). The customer's backend signed an
 * EdDSA JWT after its own login and redirected the browser to `/login/jwt-callback#{JWT}`;
 * the token rode in the URL hash (never sent to the server/logs), so a client component
 * reads it and posts it here. We verify the signature with the site's public key and the
 * `host` claim against the request host (anti-replay), then mint our own session carrying
 * the asserted `groups`. Returns an error string (no throw) for inline display; like the
 * password path we DON'T redirect() — the client hard-navigates so the tenant Host rewrite
 * re-runs (see the CLAUDE.md gotcha).
 */
export async function submitReaderJwt(input: {
  slug: string;
  token: string;
  redirectTo: string;
}): Promise<ReaderLoginState> {
  const record = await getSiteBySlug(input.slug);
  const publicKey = (record?.authConfig as ReaderAuthConfig | null)?.publicKey;
  if (!record?.authEnabled || record.authMethod !== "jwt" || !publicKey) {
    return { error: "JWT sign-in isn't enabled for this site." };
  }

  // The token's `host` claim must equal the docs domain it's being presented to. Prefer
  // `x-papervine-host` (the canonical tenant host the middleware stamps) over the raw Host
  // header, matching the custom-domain routes — so the check stays correct for a custom
  // domain (e.g. docs.example.com) even if a SaaS-domains proxy ever rewrites Host (SPEC §2).
  const h = await headers();
  const host = h.get("x-papervine-host") ?? h.get("host") ?? "";
  const result = await verifyReaderJwt(input.token, publicKey, host);
  if (!result.ok) return { error: result.error };

  // `expiresAt` (unix seconds) is the customer-controlled session length; honor it within
  // our ceiling. Absent → default TTL (handled by mintReaderSession).
  const now = Date.now();
  const ttlMs =
    typeof result.user.expiresAt === "number"
      ? Math.min(Math.max(result.user.expiresAt * 1000 - now, 0), MAX_JWT_SESSION_MS)
      : undefined;

  await setReaderCookie(
    mintReaderSession(record.id, now, { ttlMs, groups: result.user.groups }),
  );

  return { ok: true, redirectTo: safeRedirect(input.redirectTo, "/") };
}
