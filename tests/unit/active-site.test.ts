import { describe, it, expect } from "vitest";
import { resolveActiveSite } from "../../src/lib/active-site";

const sites = [
  { slug: "alpha", name: "Alpha" },
  { slug: "beta", name: "Beta" },
];

describe("resolveActiveSite", () => {
  it("returns the site matching the cookie slug", () => {
    expect(resolveActiveSite(sites, "beta")?.slug).toBe("beta");
  });

  it("falls back to the first site when the cookie is missing", () => {
    expect(resolveActiveSite(sites, undefined)?.slug).toBe("alpha");
    expect(resolveActiveSite(sites, null)?.slug).toBe("alpha");
  });

  it("falls back to the first site when the cookie names a site the user doesn't have", () => {
    // Stale or foreign cookie (e.g. site deleted, or a slug from another org).
    expect(resolveActiveSite(sites, "gamma")?.slug).toBe("alpha");
  });

  it("returns null when there are no sites", () => {
    expect(resolveActiveSite([], "anything")).toBeNull();
  });
});
