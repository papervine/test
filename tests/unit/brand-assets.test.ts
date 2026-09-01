import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_ASSETS, BRAND_PREFIX, PLATFORM_ICONS, brandAssetUrl } from "@/lib/brand";

// The brand endpoint serves files from disk (src/assets/brand) through an allowlist. Two things
// can silently break it: a table entry naming a file nobody added, and the artwork drifting out of
// step with the copy our own docs site renders.

const ROOT = path.join(__dirname, "..", "..");
const brandFile = (name: string) => path.join(ROOT, "src", "assets", "brand", name);

describe("brand assets", () => {
  it("every allowlisted asset exists on disk", () => {
    for (const [name, entry] of Object.entries(BRAND_ASSETS)) {
      const bytes = readFileSync(brandFile(entry.file));
      expect(bytes.byteLength, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  it("serves the logotype, the mark and a full icon set", () => {
    // The reason this endpoint exists: a URL for the logotype. Losing it to a refactor should
    // fail here rather than in someone else's README.
    for (const name of [
      "logotype.svg",
      "logotype-on-dark.svg",
      "mark.svg",
      "favicon.ico",
      "favicon-32x32.png",
      "apple-touch-icon.png",
      "site.webmanifest",
    ]) {
      expect(Object.keys(BRAND_ASSETS), `${name} is no longer served`).toContain(name);
    }
  });

  it("builds URLs under /brand and refuses a name it doesn't serve", () => {
    expect(brandAssetUrl("logotype.svg")).toBe("/brand/logotype.svg");
    expect(brandAssetUrl("logotype.svg").startsWith(BRAND_PREFIX)).toBe(true);
    expect(() => brandAssetUrl("logo.svg")).toThrow(/no brand asset/);
  });

  it("only points the platform <head> at assets it actually serves", () => {
    for (const icon of PLATFORM_ICONS) {
      const name = icon.href.slice(BRAND_PREFIX.length);
      expect(Object.keys(BRAND_ASSETS), `<head> references ${icon.href}`).toContain(name);
    }
  });

  it("keeps the served logotype identical to the one our docs site renders", () => {
    // Same artwork, two consumers: `/brand/logotype.svg` (this endpoint) and `/logo/light.svg`
    // (docs/docs.json, served by the docs site itself — including standalone, through the CLI,
    // where it can't reach this route). Editing one and not the other is the failure this catches.
    const pairs: [string, string][] = [
      ["logotype.svg", path.join("docs", "logo", "light.svg")],
      ["logotype-on-dark.svg", path.join("docs", "logo", "dark.svg")],
    ];
    for (const [served, docsCopy] of pairs) {
      expect(
        readFileSync(brandFile(served), "utf8"),
        `${served} and ${docsCopy} have drifted — copy one over the other`,
      ).toBe(readFileSync(path.join(ROOT, docsCopy), "utf8"));
    }
  });

  it("ships SVGs that are actually SVGs, with an accessible name", () => {
    for (const name of ["logotype.svg", "logotype-on-dark.svg", "mark.svg"]) {
      const svg = readFileSync(brandFile(name), "utf8");
      expect(svg).toMatch(/^<svg[^>]+viewBox="/);
      expect(svg, `${name} has no accessible name`).toContain('aria-label="Papervine"');
    }
  });

  it("ships a manifest whose icons resolve through this endpoint", () => {
    // The manifest arrived from a favicon generator with empty name fields and root-relative icon
    // paths (`/android-chrome-192x192.png`), which don't exist here — the apex would look them up
    // in the docs content and 404.
    const manifest = JSON.parse(readFileSync(brandFile("site.webmanifest"), "utf8")) as {
      name: string;
      icons: { src: string }[];
    };
    expect(manifest.name).toBe("Papervine");
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(BRAND_PREFIX), `${icon.src} is not a /brand URL`).toBe(true);
      expect(Object.keys(BRAND_ASSETS)).toContain(icon.src.slice(BRAND_PREFIX.length));
    }
  });
});
