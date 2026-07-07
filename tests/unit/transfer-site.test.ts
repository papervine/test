import { describe, it, expect } from "vitest";
import {
  canManageSites,
  destinationOptions,
  installationCarries,
} from "@/lib/transfer-site";

describe("canManageSites", () => {
  it("allows owner and admin", () => {
    expect(canManageSites("owner")).toBe(true);
    expect(canManageSites("admin")).toBe(true);
  });

  it("rejects member, null, and unknown roles", () => {
    expect(canManageSites("member")).toBe(false);
    expect(canManageSites(null)).toBe(false);
    expect(canManageSites(undefined)).toBe(false);
    expect(canManageSites("superuser")).toBe(false);
  });
});

describe("destinationOptions", () => {
  const orgs = [
    { id: "src", slug: "src-org", name: "Source", role: "owner" },
    { id: "b", slug: "org-b", name: "B", role: "admin" },
    { id: "c", slug: "org-c", name: "C", role: "member" },
    { id: "d", slug: "org-d", name: "D", role: null },
  ];

  it("excludes the site's current org even when the actor owns it", () => {
    const slugs = destinationOptions(orgs, "src").map((o) => o.slug);
    expect(slugs).not.toContain("src-org");
  });

  it("keeps ineligible orgs, flagged, instead of hiding them (the regression: a member-only org read as 'not a member of any other org')", () => {
    expect(destinationOptions(orgs, "src")).toEqual([
      { slug: "org-b", name: "B", eligible: true },
      { slug: "org-c", name: "C", eligible: false },
      { slug: "org-d", name: "D", eligible: false },
    ]);
  });

  it("is empty only when the actor has no other org at all", () => {
    expect(destinationOptions([orgs[0]], "src")).toEqual([]);
  });
});

describe("installationCarries", () => {
  it("always carries a site with no GitHub App link (public repo or PAT)", () => {
    expect(installationCarries(null, [])).toBe(true);
    expect(installationCarries(null, [42])).toBe(true);
  });

  it("carries only when the destination org holds the same installation", () => {
    expect(installationCarries(42, [7, 42])).toBe(true);
    expect(installationCarries(42, [7])).toBe(false);
    expect(installationCarries(42, [])).toBe(false);
  });
});
