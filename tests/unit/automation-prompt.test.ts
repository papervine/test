import { describe, expect, it } from "vitest";
import { buildRunPrompt } from "@/lib/automations/prompt";
import { getCatalogEntry } from "@/lib/automations/catalog";

describe("buildRunPrompt", () => {
  it("uses the catalog base prompt for predefined automations", () => {
    const p = buildRunPrompt({ catalogKey: "fix-broken-links" });
    expect(p).toContain(getCatalogEntry("fix-broken-links")!.basePrompt);
  });

  it("appends owner instructions after the base prompt", () => {
    const p = buildRunPrompt({
      catalogKey: "fix-broken-links",
      additionalPrompt: "Never touch the /legacy section.",
    })!;
    const base = p.indexOf("Find internal links");
    const extra = p.indexOf("Never touch the /legacy section.");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(extra).toBeGreaterThan(base);
  });

  it("renders translate target locales from extras", () => {
    const p = buildRunPrompt({
      catalogKey: "translate-content",
      extras: { targetLocales: ["fr", "de"] },
    });
    expect(p).toContain("fr, de");
  });

  it("ignores malformed extras rather than crashing", () => {
    const p = buildRunPrompt({
      catalogKey: "translate-content",
      extras: { targetLocales: "fr" as unknown as string[] },
    });
    expect(p).not.toBeNull();
    expect(p).not.toContain("Additional target languages");
  });

  it("custom automations use the additional prompt as the whole task", () => {
    const p = buildRunPrompt({
      catalogKey: "custom",
      name: "TV spot redesign",
      additionalPrompt: "Rewrite the launch page for the new TV spot.",
    })!;
    expect(p).toContain("Custom automation: TV spot redesign.");
    expect(p).toContain("Rewrite the launch page");
  });

  it("returns null for an empty custom prompt or unknown key (config errors)", () => {
    expect(buildRunPrompt({ catalogKey: "custom", additionalPrompt: "  " })).toBeNull();
    expect(buildRunPrompt({ catalogKey: "does-not-exist" })).toBeNull();
  });

  it("includes trigger context when provided", () => {
    const p = buildRunPrompt({
      catalogKey: "fix-broken-links",
      triggerContext: "content_update @ 3f2c1a9",
    });
    expect(p).toContain("triggered by: content_update @ 3f2c1a9");
  });
});
