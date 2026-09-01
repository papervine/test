/**
 * Sanitize a `?redirect=` value into a path on THIS host, or null.
 *
 * Same-host-relative only: an absolute URL, a protocol-relative `//evil.com`, or anything
 * containing a backslash (which some URL parsers normalize to `/`) is dropped. Anyone can hang a
 * query param off our login URL, and honoring one that names another origin is a textbook open
 * redirect — the more so on a login page, where what gets handed over is a freshly authenticated
 * visitor.
 *
 * Lives in `lib/` rather than beside the auth pages because BOTH ends of the resume need it: the
 * client form after a successful sign-in (`post-auth-dest.ts`) and the edge middleware, which
 * has to stop bouncing an already-signed-in visitor to `/` when they arrived at an auth page
 * mid-flow. A pure function of a string, so `tests/unit/safe-redirect.test.ts` needs no browser.
 */
export function safeRedirect(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  return raw;
}
