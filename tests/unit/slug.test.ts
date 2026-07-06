import { describe, it, expect } from "vitest";
import { isReservedOrgSlug, slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Inc")).toBe("acme-inc");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugify("Hello,   World!! 2")).toBe("hello-world-2");
  });
  it("trims leading/trailing separators", () => {
    expect(slugify("  --Pixwel--  ")).toBe("pixwel");
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
