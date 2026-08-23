import { describe, it, expect } from "vitest";
import {
  SETTINGS_NAV,
  SETTINGS_SLUGS,
  FIRST_SETTINGS_SLUG,
  settingsHref,
  settingsLabel,
  settingsNavFor,
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

// What one viewer actually sees. The catalog above stays complete (route validation needs
// every slug); this is the visibility layer.
describe("settingsNavFor", () => {
  const slugsIn = (sections: ReturnType<typeof settingsNavFor>) =>
    sections.flatMap((s) => s.items.map((i) => i.slug));
  const headings = (sections: ReturnType<typeof settingsNavFor>) =>
    sections.map((s) => s.heading);

  it("strips operator-only items for a normal viewer", () => {
    const nav = settingsNavFor({ platformAdmin: false });
    expect(slugsIn(nav)).not.toContain("api-keys");
    expect(slugsIn(nav)).not.toContain("add-ons");
    expect(slugsIn(nav)).toContain("general");
  });

  it("keeps everything for the platform operator", () => {
    expect(slugsIn(settingsNavFor({ platformAdmin: true }))).toEqual(SETTINGS_SLUGS);
  });

  // Git settings is shown for BOTH site kinds (SPEC §10.11): a Git site configures its repo
  // there, and a Papervine-hosted site connects to GitHub there. Hiding it from hosted sites
  // is what made "I see no way to connect it to GitHub" true, so it must stay reachable.
  it("keeps Git settings visible regardless of site kind", () => {
    for (const platformAdmin of [true, false]) {
      const nav = settingsNavFor({ platformAdmin });
      expect(slugsIn(nav)).toContain("git");
      expect(headings(nav)).toContain("Deployment");
    }
  });

  it("never returns a section with no items", () => {
    for (const platformAdmin of [true, false])
      for (const section of settingsNavFor({ platformAdmin }))
        expect(section.items.length).toBeGreaterThan(0);
  });
});
