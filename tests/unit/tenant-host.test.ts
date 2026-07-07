import { describe, it, expect } from "vitest";
import {
  resolveTenantSlug,
  supportsSubdomainTenants,
  isPlatformHost,
} from "@/lib/tenant-host";

describe("resolveTenantSlug", () => {
  it("maps a tenant subdomain to its slug", () => {
    expect(resolveTenantSlug("acme.localhost:3100")).toBe("acme");
    expect(resolveTenantSlug("acme.papervine.io")).toBe("acme");
    expect(resolveTenantSlug("starter-docs.localhost")).toBe("starter-docs");
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

describe("isPlatformHost", () => {
  it("is true for hosts Papervine answers on (apex, subdomains, previews, dev)", () => {
    expect(isPlatformHost("papervine.io")).toBe(true);
    expect(isPlatformHost("acme.papervine.io")).toBe(true);
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
