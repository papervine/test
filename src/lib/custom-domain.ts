// Custom (vanity) domain parsing for the Domain setup surface (SPEC §2). Pure +
// unit-tested so the server action and the UI validate identically. The DB lookup
// and routing live elsewhere (tenant.ts / middleware); this just normalizes the
// owner's free-text input into a bare hostname (or a friendly error).
import { isReservedPlatformHost, isOnPlatformDomain } from "./tenant-host";

// A conservative DNS hostname: 1–253 chars, dot-separated labels of letters/digits/
// hyphens (no leading/trailing hyphen), at least two labels (must be fully-qualified).
const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export type ParsedDomain =
  | {
      ok: true;
      domain: string;
      /**
       * True when the host sits on the domain Papervine itself owns (e.g. `docs.{platform}`).
       * Structurally fine to serve — but only the operator may claim one, so the server
       * action checks platform-admin before saving. Left to the caller because this module
       * is pure and has no session.
       */
      requiresOperator: boolean;
    }
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
  // Only STRUCTURALLY ours is refused outright: the apex, its function labels, and the
  // tenant domain. A host like `docs.{platform}` is not — the org that owns the platform
  // domain can legitimately point it at one of its own sites, which is the custom-domain
  // feature working as intended rather than an exception to it. Authorization for those is
  // the caller's job (`requiresOperator`).
  if (isReservedPlatformHost(host))
    return { ok: false, error: "That host is reserved by Papervine — enter another domain." };

  return { ok: true, domain: host, requiresOperator: isOnPlatformDomain(host) };
}
