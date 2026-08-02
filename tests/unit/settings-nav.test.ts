import { describe, it, expect } from "vitest";
import {
  SETTINGS_NAV,
  SETTINGS_SLUGS,
  FIRST_SETTINGS_SLUG,
  settingsHref,
  settingsLabel,
} from "@/lib/settings-nav";

describe("settings nav config", () => {
  it("matches the designed IA — 5 sections, 16 surfaces", () => {
    expect(SETTINGS_NAV.map((s) => s.heading)).toEqual([
      "Site settings",
      "Deployment",
      "Security & access",
      "Workspace",
      "Advanced",
    ]);
    expect(SETTINGS_SLUGS).toHaveLength(16);
  });

  it("has unique slugs", () => {
    expect(new Set(SETTINGS_SLUGS).size).toBe(SETTINGS_SLUGS.length);
  });

  it("lands on Domain setup first (matches the breadcrumb)", () => {
    expect(FIRST_SETTINGS_SLUG).toBe("domain");
    expect(settingsLabel(FIRST_SETTINGS_SLUG)).toBe("Domain setup");
  });

  it("builds bare hrefs under the URL-scoped site (/:org/:site/settings)", () => {
    expect(settingsHref("acme", "docs", "api-keys")).toBe(
      "/acme/docs/settings/api-keys",
    );
  });

  it("resolves labels for every slug, undefined for unknown", () => {
    for (const slug of SETTINGS_SLUGS)
      expect(settingsLabel(slug)).toBeTruthy();
    expect(settingsLabel("nope")).toBeUndefined();
  });
});
