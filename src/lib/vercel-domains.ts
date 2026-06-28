import "server-only";

// Vercel domains client for BYO custom domains (SPEC §2 → Custom domains, Phase 1).
// Attaching a customer's host (docs.example.com) to our Vercel project is what makes the
// platform issue a per-host TLS cert (HTTP-01) and route the host to us — DNS pointing
// here is necessary but NOT sufficient. Without an attach call the TLS handshake to the
// vanity host never completes, so the "Connected" check (which fetches https://{host}/…)
// can never pass in production. This is the seam SPEC calls for: "attach via the
// host-platform domains API, poll until verified + TLS issued."
//
// Best-effort and env-gated: with no VERCEL_TOKEN (local dev, CI) every call is a no-op
// and the Domain setup action degrades to the DNS-only live check, unchanged. The token
// raises no rate-limit concern here (a handful of calls per connect), mirroring the
// GITHUB_TOKEN seam in github.ts.
const API = "https://api.vercel.com";

// The literal Vercel edge — the CNAME fallback when no branded host is configured but
// Vercel manages domains. Works, just unbranded.
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com";

const token = () => process.env.VERCEL_TOKEN;
const projectId = () => process.env.VERCEL_PROJECT_ID;
const teamId = () => process.env.VERCEL_TEAM_ID;

// Whether the platform is wired to manage domains via Vercel. False locally / in CI
// (no token), where the caller falls back to the DNS-only path and the form shows the
// generic CNAME instruction instead of Vercel's exact records.
export function vercelDomainsConfigured(): boolean {
  return Boolean(token() && projectId());
}

// What we tell customers to CNAME their vanity host at, in precedence order:
//  1. CUSTOM_DOMAIN_CNAME_TARGET — an operator-owned branded host (e.g. cname.example.com,
//     itself a CNAME to the provider's edge). SHOULD be set in any multi-tenant prod: it's
//     the stable, provider-agnostic contract that survives the Phase 2 cap escape (SPEC §2)
//     — the provider's real edge moves behind this one record we control, so no customer
//     re-points DNS at migration. Papervine's hosted prod sets it to cname.papervine.io;
//     a self-hoster sets their own host (verified: Vercel cold-issues the cert through the
//     CNAME chain, SPEC §2). Keep this provider-agnostic — never hardcode an operator domain.
//  2. The raw Vercel edge — Vercel manages domains but no branded host is set. Unbranded,
//     and bakes Vercel into customer zones, but it works out of the box.
//  3. The platform apex — self-host / no Vercel, where Domain setup falls back to the
//     DNS-only live check and the path/self-host story.
// (Apex customer domains use an A record regardless — out of this CNAME seam.)
export function customDomainCnameTarget(apexBase: string): string {
  return (
    process.env.CUSTOM_DOMAIN_CNAME_TARGET ||
    (vercelDomainsConfigured() ? VERCEL_CNAME_TARGET : apexBase)
  );
}

function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${token()}`, "content-type": "application/json" };
}

// teamId is a query param on every call when present: team-scoped tokens require it or
// the API 403s; personal-account tokens must omit it.
function url(path: string): string {
  const id = teamId();
  if (!id) return `${API}${path}`;
  return `${API}${path}${path.includes("?") ? "&" : "?"}teamId=${id}`;
}

async function fetchJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url(path), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// An ownership-verification record Vercel wants set when the host (or its apex) is
// already used elsewhere on the platform. Empty once Vercel has verified ownership.
export type DomainVerification = {
  type: string; // e.g. "TXT"
  domain: string; // record name
  value: string; // record value
  reason?: string;
};

export type DomainStatus = {
  // Vercel verified domain ownership (the challenge below, if any, is satisfied).
  verified: boolean;
  // DNS A/CNAME doesn't yet point at Vercel, so the cert can't issue / traffic won't route.
  misconfigured: boolean;
  // Ownership-verification records Vercel requires (empty once verified).
  verification: DomainVerification[];
};

// Pure: fold Vercel's project-domain object + domain-config object into our status
// shape. Kept separate from the fetch so it's unit-testable without the network.
export function parseDomainStatus(
  projectDomain: Record<string, unknown> | null,
  config: Record<string, unknown> | null,
): DomainStatus {
  const verification = Array.isArray(projectDomain?.verification)
    ? (projectDomain.verification as unknown[]).filter(
        (v): v is DomainVerification =>
          typeof v === "object" && v !== null && "type" in v && "value" in v,
      )
    : [];
  return {
    verified: projectDomain?.verified === true,
    misconfigured: config?.misconfigured === true,
    verification,
  };
}

export type AddDomainResult = { ok: boolean; error?: string };

/**
 * Attach the host to our Vercel project so the platform issues its cert. Idempotent: a
 * domain already attached to *this* project (409 with no body change) counts as success.
 * A 409 because the host is attached to a *different* Vercel project is a real failure —
 * surfaced so the owner can fix it (our DB unique constraint already blocks two of our
 * own sites from colliding). No-op when Vercel isn't configured.
 */
export async function addProjectDomain(domain: string): Promise<AddDomainResult> {
  if (!vercelDomainsConfigured()) return { ok: true };
  let res: Response;
  try {
    res = await fetch(url(`/v10/projects/${projectId()}/domains`), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: domain }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach the domains service. Try again." };
  }
  if (res.ok) return { ok: true };

  const body = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  const code = body?.error?.code;
  // Vercel returns `409 domain_already_in_use` whether the host is already attached to OUR
  // project (so the add is a harmless no-op → success) or to a DIFFERENT one (a real failure).
  // The error body doesn't distinguish them, so confirm by reading our own project's domains:
  // a 200 means it's ours, and the attach is idempotent. Without this, re-saving an unchanged
  // domain (e.g. just toggling the /docs subpath) wrongly errors in prod. (SPEC §2 reconciler.)
  if (res.status === 409 && code === "domain_already_in_use") {
    if (await projectOwnsDomain(domain)) return { ok: true };
    return { ok: false, error: "That domain is already attached to another project." };
  }
  return { ok: false, error: body?.error?.message ?? "Couldn't attach the domain." };
}

/** Is this host already attached to *our* Vercel project? Used to make `addProjectDomain`
 *  idempotent on a 409. A network error reads as "not confirmed ours" (caller surfaces the
 *  conflict) rather than a false success. */
async function projectOwnsDomain(domain: string): Promise<boolean> {
  try {
    const res = await fetch(url(`/v9/projects/${projectId()}/domains/${domain}`), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Detach the host from our project (frees the project-domain slot). Best-effort: a 404
// (already gone) is success. No-op when Vercel isn't configured.
export async function removeProjectDomain(domain: string): Promise<boolean> {
  if (!vercelDomainsConfigured()) return true;
  try {
    const res = await fetch(url(`/v9/projects/${projectId()}/domains/${domain}`), {
      method: "DELETE",
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

// Live ownership/cert state for a connected host — drives the exact DNS records the form
// shows while a domain is pending. null when Vercel isn't configured or both lookups
// fail (the caller then shows the generic CNAME instruction).
export async function getDomainStatus(domain: string): Promise<DomainStatus | null> {
  if (!vercelDomainsConfigured()) return null;
  const [projectDomain, config] = await Promise.all([
    fetchJson(`/v9/projects/${projectId()}/domains/${domain}`),
    fetchJson(`/v6/domains/${domain}/config`),
  ]);
  if (!projectDomain && !config) return null;
  return parseDomainStatus(projectDomain, config);
}
