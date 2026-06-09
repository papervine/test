import { describe, it, expect } from "vitest";
import { resolveTenantSlug, supportsSubdomainTenants } from "@/lib/tenant-host";

describe("resolveTenantSlug", () => {
  it("maps a tenant subdomain to its slug", () => {
    expect(resolveTenantSlug("acme.localhost:3100")).toBe("acme");
    expect(resolveTenantSlug("acme.docbot.app")).toBe("acme");
    expect(resolveTenantSlug("starter.localhost")).toBe("starter");
  });
  it("returns null for the apex / platform hosts", () => {
    expect(resolveTenantSlug("localhost:3100")).toBeNull();
    expect(resolveTenantSlug("docbot.app")).toBeNull();
    expect(resolveTenantSlug("docbot-two.vercel.app")).toBeNull();
  });
  it("treats reserved subdomains as platform, not tenants", () => {
    expect(resolveTenantSlug("app.docbot.app")).toBeNull();
    expect(resolveTenantSlug("www.docbot.app")).toBeNull();
  });
  it("is case-insensitive and null-safe", () => {
    expect(resolveTenantSlug("ACME.docbot.app")).toBe("acme");
    expect(resolveTenantSlug(null)).toBeNull();
  });
});

describe("supportsSubdomainTenants", () => {
  it("is true for hosts the resolver recognizes (wildcard available)", () => {
    expect(supportsSubdomainTenants("docbot.app")).toBe(true);
    expect(supportsSubdomainTenants("localhost:3100")).toBe(true);
    expect(supportsSubdomainTenants("localhost")).toBe(true);
  });
  it("is false where nested-subdomain serving can't work (use the path form)", () => {
    expect(supportsSubdomainTenants("docbot-two.vercel.app")).toBe(false);
    expect(supportsSubdomainTenants("example.com")).toBe(false);
    expect(supportsSubdomainTenants("")).toBe(false);
  });
});
