import { describe, it, expect } from "vitest";
import { isReservedOrgSlug, isReservedSiteSlug, slugify } from "@/lib/slug";
import { resolveTenantSlug, domains } from "@/lib/tenant-host";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("Hello,   World!! 2")).toBe("hello-world-2");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("  --Beta--  ")).toBe("beta");
  });
  it("handles empty/garbage input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
  });
});

describe("isReservedOrgSlug", () => {
  it("reserves the static control-plane paths", () => {
    // Each of these is a real app-host path that would shadow an org's dashboard:
    // /admin and /preview are static route segments, the rest are middleware-handled.
    for (const slug of ["admin", "preview", "login", "signup", "onboarding", "accept-invite", "api", "app"]) {
      expect(isReservedOrgSlug(slug)).toBe(true);
    }
  });
  it("allows normal org slugs", () => {
    expect(isReservedOrgSlug("acme")).toBe(false);
    expect(isReservedOrgSlug("adminco")).toBe(false);
  });
});

describe("reserved SITE slugs agree with the host resolver", () => {
  // The bug this exists to prevent: a slug that site creation happily assigns but the host
  // resolver refuses to map. Such a site is created, shows in the dashboard, and its
  // subdomain silently serves the marketing page instead of its docs — no error anywhere.
  // The two lists lived in different files and drifted exactly that way.
  it("every assignable slug actually resolves on the tenant domain", () => {
    for (const slug of ["api", "app", "www", "acme", "my-docs", "connect", "docs"]) {
      if (isReservedSiteSlug(slug)) continue; // refused up front — fine, never created
      expect(
        resolveTenantSlug(`${slug}.${domains.tenant}`),
        `site slug "${slug}" is assignable but does not resolve to a tenant`,
      ).toBe(slug);
    }
  });

  it("keeps the slugs we genuinely need to hold back", () => {
    expect(isReservedSiteSlug("connect")).toBe(true); // shadowed by /:org/connect
    expect(isReservedSiteSlug("docs")).toBe(true); // our own dogfooded docs site
    expect(isReservedSiteSlug("acme")).toBe(false);
  });
});
