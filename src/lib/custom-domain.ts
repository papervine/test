// Custom (vanity) domain parsing for the Domain setup surface (SPEC §2). Pure +
// unit-tested so the server action and the UI validate identically. The DB lookup
// and routing live elsewhere (tenant.ts / middleware); this just normalizes the
// owner's free-text input into a bare hostname (or a friendly error).
import { isPlatformHost } from "./tenant-host";

// A conservative DNS hostname: 1–253 chars, dot-separated labels of letters/digits/
// hyphens (no leading/trailing hyphen), at least two labels (must be fully-qualified).
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type ParsedDomain =
  | { ok: true; domain: string }
  | { ok: false; error: string };

/**
 * Normalize an owner-entered domain to a bare lowercase hostname, or explain why it's
 * rejected. Strips a leading scheme, any path/query, a port, and a trailing dot — so
 * `https://Docs.Example.com/guides` → `docs.example.com`. Platform hosts (papervine.io,
 * *.localhost, …) are refused: a tenant can't claim one of ours.
 */
export function parseCustomDomain(input: string): ParsedDomain {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return { ok: false, error: "Enter a domain." };

  const host = raw
    .replace(/^https?:\/\//, "") // scheme
    .replace(/\/.*$/, "") // path / query / fragment
    .split(":")[0] // port
    .replace(/\.$/, ""); // trailing dot (FQDN form)

  if (!host) return { ok: false, error: "Enter a domain." };
  if (!HOSTNAME_RE.test(host))
    return { ok: false, error: "That doesn't look like a valid domain." };
  if (isPlatformHost(host))
    return { ok: false, error: "That's a Papervine host — enter your own domain." };

  return { ok: true, domain: host };
}
