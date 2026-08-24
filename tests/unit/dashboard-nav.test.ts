import { describe, it, expect } from "vitest";
import {
  siteBase,
  siteHref,
  connectHref,
  siteRoute,
  parseSitePath,
  pickCurrentSite,
  switchSiteHref,
  postCreateHref,
} from "@/lib/dashboard-nav";

const sites = [
  { slug: "alpha", name: "Alpha" },
  { slug: "beta", name: "Beta" },
];

describe("public (bare) helpers", () => {
  it("builds the bare site base path", () => {
    expect(siteBase("acme", "docs")).toBe("/acme/docs");
  });

  it("appends a sub-path, or returns the base for an empty sub", () => {
    expect(siteHref("acme", "docs", "analytics")).toBe("/acme/docs/analytics");
    expect(siteHref("acme", "docs")).toBe("/acme/docs");
    expect(siteHref("acme", "docs", "")).toBe("/acme/docs");
  });

  it("builds the connect path", () => {
    expect(connectHref("acme")).toBe("/acme/connect");
  });

  // The "View run" action on the run-queued toast (AutomationCard) navigates here. Pinned
  // because the toast is the only way into a run you just triggered, and the happy path can't
  // be covered in e2e: that suite blanks TRIGGER_SECRET_KEY by contract, so a manual trigger
  // there always returns "executor is not configured" and never produces a run to link to.
  it("builds an automation run's detail path", () => {
    expect(siteHref("acme", "docs", "automate/automations/runs/abc-123")).toBe(
      "/acme/docs/automate/automations/runs/abc-123",
    );
  });
});

describe("internal (/app) route helper", () => {
  it("prefixes the invisible mount for revalidatePath", () => {
    expect(siteRoute("acme", "docs")).toBe("/app/acme/docs");
    expect(siteRoute("acme", "docs", "settings/domain")).toBe(
      "/app/acme/docs/settings/domain",
    );
  });
});

describe("parseSitePath", () => {
  it("pulls org + site out of a bare dashboard path", () => {
    expect(parseSitePath("/acme/docs/analytics")).toEqual({
      orgSlug: "acme",
      siteSlug: "docs",
    });
  });

  it("reads the connect segment as the (non-)site on the org-level page", () => {
    expect(parseSitePath("/acme/connect")).toEqual({
      orgSlug: "acme",
      siteSlug: "connect",
    });
  });
});

describe("pickCurrentSite", () => {
  it("returns the site matching the path slug", () => {
    expect(pickCurrentSite(sites, "beta")?.slug).toBe("beta");
  });

  it("falls back to the first site when the path has no/unknown site", () => {
    expect(pickCurrentSite(sites, undefined)?.slug).toBe("alpha");
    expect(pickCurrentSite(sites, "connect")?.slug).toBe("alpha");
    expect(pickCurrentSite(sites, "gamma")?.slug).toBe("alpha");
  });

  it("returns null when there are no sites", () => {
    expect(pickCurrentSite([], "anything")).toBeNull();
  });
});

describe("switchSiteHref", () => {
  it("preserves the current sub-page when switching sites", () => {
    expect(switchSiteHref("acme", "beta", "/acme/alpha/analytics", sites)).toBe(
      "/acme/beta/analytics",
    );
    expect(
      switchSiteHref("acme", "beta", "/acme/alpha/settings/domain", sites),
    ).toBe("/acme/beta/settings/domain");
  });

  it("lands on the new site's home from a site root", () => {
    expect(switchSiteHref("acme", "beta", "/acme/alpha", sites)).toBe(
      "/acme/beta",
    );
  });

  it("lands on the new site's home from an org-level page (no site in path)", () => {
    expect(switchSiteHref("acme", "beta", "/acme/connect", sites)).toBe(
      "/acme/beta",
    );
  });
});

// Where a freshly-created site drops you (SPEC §10.11). A Papervine-hosted site is seeded
// and live immediately, so the next action is writing — but Studio is gated to
// owners/admins, and sending anyone else there would hit its notFound().
describe("postCreateHref", () => {
  it("opens Studio for someone who can see it", () => {
    expect(postCreateHref("acme", "docs", "owner")).toBe("/acme/docs/editor");
    expect(postCreateHref("acme", "docs", "admin")).toBe("/acme/docs/editor");
  });

  it("falls back to the site Overview for anyone who can't", () => {
    expect(postCreateHref("acme", "docs", "member")).toBe("/acme/docs");
    expect(postCreateHref("acme", "docs", null)).toBe("/acme/docs");
    expect(postCreateHref("acme", "docs", undefined)).toBe("/acme/docs");
  });
});
