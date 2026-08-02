/**
 * Pure helpers for the embeddable assistant widget's origin allowlist (SPEC §8.7). Kept
 * DB-free so they're unit-testable: `normalizeOrigin` validates/canonicalizes what an owner
 * types into the settings form, and `isOriginAllowed` is the exact check the widget chat
 * route runs against every cross-origin request's `Origin` header.
 */

/**
 * Validate and canonicalize a user-entered origin: `http(s)://host[:port]` only — no path,
 * query, hash, or wildcard (matches the settings UI's own stated constraint). Returns the
 * canonical origin string (default ports stripped, host lowercased by the URL parser), or
 * null for anything that isn't exactly an origin.
 */
export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("*")) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  return url.origin;
}

/** Exact-match the request's Origin header against a site's configured allowlist. */
export function isOriginAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}
