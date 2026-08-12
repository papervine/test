import { describe, it, expect } from "vitest";
import {
  resolveTenantSlug,
  supportsSubdomainTenants,
  isPlatformHost,
  legacyTenantRedirectHost,
  tenantHostFor,
  domains,
} from "@/lib/tenant-host";

// The whole point of the split is that these are DIFFERENT registrable domains: the
// control plane's cookies live on one, customer-authored content renders on the other.
// If they ever collapse to the same value the isolation is gone silently, so assert it.
describe("the platform and tenant domains are distinct", () => {
  it("never share a registrable domain", () => {
    expect(domains.tenant).not.toBe(domains.platform);
  });
  it("ships the intended defaults", () => {
    // Pinned literally so a typo in the constant fails here rather than in production DNS.
    // Other suites derive from `domains`, so this is the one place the strings are asserted.
    expect(domains.platform).toBe("papervine.io");
    expect(domains.tenant).toBe("papervine.page");
  });
});

describe("resolveTenantSlug", () => {
  it("maps a tenant subdomain to its slug", () => {
    expect(resolveTenantSlug("acme.localhost:3100")).toBe("acme");
    expect(resolveTenantSlug(`acme.${domains.tenant}`)).toBe("acme");
    expect(resolveTenantSlug("starter-docs.localhost")).toBe("starter-docs");
  });
  it("still resolves legacy platform-domain tenant hosts (old links stay alive)", () => {
    expect(resolveTenantSlug(`acme.${domains.platform}`)).toBe("acme");
  });
  it("reserves nothing on the tenant domain — `docs` is an ordinary site there", () => {
    // This is what unblocks dogfooding our own docs as a normal tenant.
    expect(resolveTenantSlug(`docs.${domains.tenant}`)).toBe("docs");
    expect(resolveTenantSlug(`app.${domains.tenant}`)).toBe("app");
    expect(resolveTenantSlug(`www.${domains.tenant}`)).toBe("www");
    // …but they stay reserved where the platform actually answers.
    expect(resolveTenantSlug(`docs.${domains.platform}`)).toBeNull();
    expect(resolveTenantSlug("app.localhost")).toBeNull();
  });
  it("returns null for the apex / platform hosts", () => {
    expect(resolveTenantSlug("localhost:3100")).toBeNull();
    expect(resolveTenantSlug("papervine.io")).toBeNull();
    expect(resolveTenantSlug("papervine-two.vercel.app")).toBeNull();
  });
  it("treats reserved subdomains as platform, not tenants", () => {
    expect(resolveTenantSlug("app.papervine.io")).toBeNull();
    expect(resolveTenantSlug("www.papervine.io")).toBeNull();
  });
  it("is case-insensitive and null-safe", () => {
    expect(resolveTenantSlug("ACME.papervine.io")).toBe("acme");
    expect(resolveTenantSlug(null)).toBeNull();
  });
});

describe("legacyTenantRedirectHost", () => {
  it("moves a legacy tenant host to its canonical home", () => {
    expect(legacyTenantRedirectHost(`acme.${domains.platform}`)).toBe(`acme.${domains.tenant}`);
  });
  it("leaves canonical, platform and dev hosts alone", () => {
    expect(legacyTenantRedirectHost(`acme.${domains.tenant}`)).toBeNull();
    expect(legacyTenantRedirectHost(`app.${domains.platform}`)).toBeNull();
    expect(legacyTenantRedirectHost(domains.platform)).toBeNull();
    expect(legacyTenantRedirectHost("acme.localhost:3000")).toBeNull();
    expect(legacyTenantRedirectHost(null)).toBeNull();
  });
});

describe("tenantHostFor", () => {
  it("uses the configured tenant domain regardless of which host asked", () => {
    // The bug this prevents: deriving the tenant host from the request would send a
    // dashboard visitor to the LEGACY host, because the dashboard runs on app.{platform}.
    expect(tenantHostFor("acme", `app.${domains.platform}`)).toBe(`acme.${domains.tenant}`);
    expect(tenantHostFor("acme", domains.platform)).toBe(`acme.${domains.tenant}`);
    expect(tenantHostFor("acme", `www.${domains.platform}`)).toBe(`acme.${domains.tenant}`);
  });
  it("stays on the local host in dev, keeping the port", () => {
    expect(tenantHostFor("acme", "app.localhost:3000")).toBe("acme.localhost:3000");
    expect(tenantHostFor("acme", "localhost:3000")).toBe("acme.localhost:3000");
  });
});

describe("isPlatformHost", () => {
  it("is true for hosts Papervine answers on (apex, subdomains, previews, dev)", () => {
    expect(isPlatformHost(domains.platform)).toBe(true);
    expect(isPlatformHost(`acme.${domains.platform}`)).toBe(true);
    // The tenant domain is ours too — otherwise middleware tries to resolve every tenant
    // host as a customer's vanity domain.
    expect(isPlatformHost(domains.tenant)).toBe(true);
    expect(isPlatformHost(`acme.${domains.tenant}`)).toBe(true);
    expect(isPlatformHost("acme.localhost:3100")).toBe(true);
    expect(isPlatformHost("localhost")).toBe(true);
    expect(isPlatformHost("127.0.0.1:3100")).toBe(true);
    expect(isPlatformHost("papervine-two.vercel.app")).toBe(true);
    expect(isPlatformHost(null)).toBe(true);
  });
  it("is false for tenant vanity domains (custom-domain candidates)", () => {
    expect(isPlatformHost("docs.example.com")).toBe(false);
    expect(isPlatformHost("help.example.io")).toBe(false);
  });
});

describe("supportsSubdomainTenants", () => {
  it("is true for hosts the resolver recognizes (wildcard available)", () => {
    expect(supportsSubdomainTenants("papervine.io")).toBe(true);
    expect(supportsSubdomainTenants("localhost:3100")).toBe(true);
    expect(supportsSubdomainTenants("localhost")).toBe(true);
  });
  it("is false where nested-subdomain serving can't work (use the path form)", () => {
    expect(supportsSubdomainTenants("papervine-two.vercel.app")).toBe(false);
    expect(supportsSubdomainTenants("example.com")).toBe(false);
    expect(supportsSubdomainTenants("")).toBe(false);
  });
});
