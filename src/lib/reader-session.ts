import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { encryptSecret, decryptSecret } from "./crypto";

// Layer 2 reader-auth session (SPEC §11.2). Once a reader satisfies a site's handshake
// (password today; JWT/OAuth later) we mint a short docs session as an encrypted cookie.
// We never store reader identity for the password method — the cookie just proves "this
// browser cleared the gate for this site, until `exp`". AES-256-GCM's auth tag makes the
// cookie unforgeable, so it doubles as the signature — no separate HMAC needed.

export const READER_COOKIE = "pv_docs_session";

// 7 days. Short enough that a rotated password / disabled gate takes effect soon, long
// enough not to nag readers every visit. Exposed in seconds for the Set-Cookie maxAge.
export const READER_SESSION_TTL_S = 7 * 24 * 60 * 60;

// `groups` rides along only for the JWT/OAuth methods — it's the reader's group membership,
// which the planned edge gate (SPEC §11.2 → Planned) reads to enforce per-group page access
// without a DB round-trip. The password method has no per-user identity, so it omits it.
type ReaderClaims = { siteId: string; exp: number; groups?: string[] };

// Mint the cookie value, bound to one site and stamped with an absolute expiry. `now` is
// injectable so the round-trip is unit-testable without faking the clock. `opts.ttlMs` lets
// the JWT handshake honor the token's `expiresAt` (capped by the caller); `opts.groups`
// carries the reader's groups for access control.
export function mintReaderSession(
  siteId: string,
  now: number = Date.now(),
  opts: { ttlMs?: number; groups?: string[] } = {},
): string {
  const ttlMs = opts.ttlMs ?? READER_SESSION_TTL_S * 1000;
  const claims: ReaderClaims = { siteId, exp: now + ttlMs };
  if (opts.groups && opts.groups.length > 0) claims.groups = opts.groups;
  return encryptSecret(JSON.stringify(claims));
}

// Decrypt + validate the cookie, returning its claims (incl. `groups`) iff it's bound to
// THIS site and hasn't expired — else null. A forged/tampered cookie fails the GCM auth tag
// (decryptSecret throws) → null. Binding to siteId matters in apex path mode, where one
// host's cookie is visible to every path-mode site; a cookie minted for site A must not
// unlock site B. The per-page group gate (SPEC §11.2) reads `groups` from here.
export function readerSession(
  cookieValue: string | undefined,
  siteId: string,
  now: number = Date.now(),
): ReaderClaims | null {
  if (!cookieValue) return null;
  try {
    const claims = JSON.parse(decryptSecret(cookieValue)) as ReaderClaims;
    if (claims.siteId !== siteId || typeof claims.exp !== "number" || claims.exp <= now) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

// True iff the cookie is a valid, unexpired session for this site — the site-level gate.
export function readerSessionValid(
  cookieValue: string | undefined,
  siteId: string,
  now: number = Date.now(),
): boolean {
  return readerSession(cookieValue, siteId, now) !== null;
}

// Constant-time password check. Both sides are SHA-256'd first so the compare is over
// fixed-length digests — constant-time regardless of input, and no length is leaked by an
// early return. For the shared-password method there's no per-user identity to compare.
export function passwordMatches(submitted: string, actual: string): boolean {
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(actual).digest();
  return timingSafeEqual(a, b);
}
