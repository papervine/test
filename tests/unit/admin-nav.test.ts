import { describe, it, expect } from "vitest";
import { ADMIN_NAV, ADMIN_SLUGS, adminHref, activeAdminSlug } from "@/lib/admin-nav";

// The Operator console's IA (SPEC §10.10). Meta-tests in the style of features.test.ts, plus the
// one piece of real logic: which tab is active. That has to survive a DETAIL route
// (/admin/orgs/{id}) lighting up its parent, which equality matching gets wrong.

describe("ADMIN_NAV catalog", () => {
  it("every item has a label and an icon", () => {
    for (const section of ADMIN_NAV) {
      expect(section.heading).toBeTruthy();
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.label).toBeTruthy();
        // Lucide icons are forwardRef objects in this version, not plain functions —
        // assert they're renderable rather than asserting a shape that will drift.
        expect(item.icon).toBeTruthy();
      }
    }
  });

  it("slugs are unique — they key the active-tab match", () => {
    expect(new Set(ADMIN_SLUGS).size).toBe(ADMIN_SLUGS.length);
  });

  it("exactly one item is the index", () => {
    expect(ADMIN_SLUGS.filter((s) => s === "").length).toBe(1);
  });

  it("no slug carries a slash — they're single segments under /admin", () => {
    for (const slug of ADMIN_SLUGS) expect(slug).not.toContain("/");
  });
});

describe("adminHref", () => {
  it("keeps the index bare rather than trailing a slash", () => {
    expect(adminHref("")).toBe("/admin");
  });

  it("builds a section path", () => {
    expect(adminHref("orgs")).toBe("/admin/orgs");
    expect(adminHref("deploys")).toBe("/admin/deploys");
  });
});

describe("activeAdminSlug", () => {
  it("matches each section exactly", () => {
    expect(activeAdminSlug("/admin")).toBe("");
    expect(activeAdminSlug("/admin/orgs")).toBe("orgs");
    expect(activeAdminSlug("/admin/deploys")).toBe("deploys");
  });

  it("tolerates a trailing slash", () => {
    expect(activeAdminSlug("/admin/")).toBe("");
    expect(activeAdminSlug("/admin/orgs/")).toBe("orgs");
  });

  // The reason this function exists: drilling into one org must keep Organizations lit.
  it("lights the parent tab on a detail route", () => {
    expect(activeAdminSlug("/admin/orgs/org_123")).toBe("orgs");
    expect(activeAdminSlug("/admin/orgs/org_123/anything")).toBe("orgs");
  });

  it("returns null outside the console, and for an unknown section", () => {
    expect(activeAdminSlug("/acme/docs")).toBeNull();
    expect(activeAdminSlug("/admin/nope")).toBeNull();
  });

  // "" would otherwise be a prefix of everything and light Overview permanently.
  it("does not light Overview on a section route", () => {
    expect(activeAdminSlug("/admin/sites")).not.toBe("");
  });
});
