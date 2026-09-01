import { describe, expect, it } from "vitest";
import {
  deleteAtPath,
  getAtPath,
  logoParts,
  logoValue,
  setAtPath,
  summarizeNavigation,
} from "@/lib/site-config-edit";
import {
  CONFIG_SECTIONS,
  allFieldPaths,
  renderedFieldPaths,
} from "@/components/editor/settings/site-config-schema";
import { docsConfigSchema, parseDocsConfig } from "@papervine/renderer/lib/config";

// The Site settings drawer edits docs.json by path. These are the two promises the whole drawer
// rests on: clearing a field REMOVES the key (a config file wants an absent logo, not `""`), and
// everything the drawer doesn't model survives untouched.

describe("getAtPath", () => {
  it("reads a nested value", () => {
    expect(getAtPath({ colors: { primary: "#f00" } }, ["colors", "primary"])).toBe("#f00");
  });

  it("returns undefined for a missing step rather than throwing", () => {
    expect(getAtPath({}, ["colors", "primary"])).toBeUndefined();
    expect(getAtPath({ colors: "nope" }, ["colors", "primary"])).toBeUndefined();
    expect(getAtPath(null, ["name"])).toBeUndefined();
  });
});

describe("setAtPath", () => {
  it("writes a nested value, creating the intermediate object", () => {
    expect(setAtPath({}, ["colors", "primary"], "#f00")).toEqual({ colors: { primary: "#f00" } });
  });

  it("preserves siblings and unmodelled blocks", () => {
    const before = {
      name: "Docs",
      api: { openapi: "spec.json" },
      colors: { primary: "#f00", light: "#0f0" },
    };
    const after = setAtPath(before, ["colors", "primary"], "#00f");
    expect(after).toEqual({
      name: "Docs",
      api: { openapi: "spec.json" },
      colors: { primary: "#00f", light: "#0f0" },
    });
    // and doesn't mutate the input — the drawer keeps the old object in React state
    expect(before.colors.primary).toBe("#f00");
  });

  it("deletes the key for an empty string or undefined", () => {
    expect(setAtPath({ name: "Docs", description: "x" }, ["description"], "")).toEqual({ name: "Docs" });
    expect(setAtPath({ name: "Docs", description: "x" }, ["description"], undefined)).toEqual({ name: "Docs" });
    expect(deleteAtPath({ name: "Docs" }, ["name"])).toEqual({});
  });

  it("keeps false and 0, which are real values", () => {
    expect(setAtPath({}, ["appearance", "strict"], false)).toEqual({ appearance: { strict: false } });
    expect(setAtPath({}, ["x"], 0)).toEqual({ x: 0 });
  });

  it("prunes an ancestor left empty, so no {} is written back", () => {
    expect(setAtPath({ logo: { light: "/l.svg" } }, ["logo", "light"], "")).toEqual({});
    expect(setAtPath({ name: "Docs", logo: { light: "/l.svg" } }, ["logo", "light"], "")).toEqual({
      name: "Docs",
    });
    // …but a sibling in the same object keeps it alive
    expect(setAtPath({ logo: { light: "/l.svg", dark: "/d.svg" } }, ["logo", "light"], "")).toEqual({
      logo: { dark: "/d.svg" },
    });
  });

  it("replaces an array wholesale (navbar links, meta tags)", () => {
    const links = [{ label: "Support", href: "https://example.com" }];
    expect(setAtPath({ navbar: { links: [] } }, ["navbar", "links"], links)).toEqual({ navbar: { links } });
  });
});

describe("logoValue / logoParts", () => {
  it("collapses a matching pair to the plain string form", () => {
    expect(logoValue({ light: "/l.svg", dark: "/l.svg" })).toBe("/l.svg");
    expect(logoValue({ light: "/l.svg" })).toBe("/l.svg");
  });

  it("uses the object form when the two differ or an href is set", () => {
    expect(logoValue({ light: "/l.svg", dark: "/d.svg" })).toEqual({ light: "/l.svg", dark: "/d.svg" });
    expect(logoValue({ light: "/l.svg", dark: "/l.svg", href: "https://x.dev" })).toEqual({
      light: "/l.svg",
      dark: "/l.svg",
      href: "https://x.dev",
    });
  });

  it("removes the key when there is nothing to write", () => {
    expect(logoValue({})).toBeUndefined();
    expect(logoValue({ light: "  " })).toBeUndefined();
  });

  it("never loses a string-form logo when one half is edited", () => {
    // The defect this pairing exists to prevent: treating `logo.light` as its own field shows an
    // empty box for a string-form logo and then replaces the string with `{light: …}`, dropping
    // the logo the site was actually using.
    const parts = logoParts("/logo.svg");
    expect(logoValue(parts)).toBe("/logo.svg"); // untouched → unchanged file
    expect(logoValue({ ...parts, dark: "/logo-dark.svg" })).toEqual({
      light: "/logo.svg",
      dark: "/logo-dark.svg",
    });
  });

  it("round-trips both shapes", () => {
    expect(logoParts("/l.svg")).toEqual({ light: "/l.svg", dark: "/l.svg", href: "" });
    expect(logoParts({ light: "/l.svg", href: "https://x.dev" })).toEqual({
      light: "/l.svg",
      dark: "",
      href: "https://x.dev",
    });
    expect(logoParts(undefined)).toEqual({ light: "", dark: "", href: "" });
  });
});

describe("summarizeNavigation", () => {
  it("counts tabs, groups and pages in the tabs shape", () => {
    const nav = {
      tabs: [
        {
          tab: "Guides",
          groups: [
            { group: "Start", pages: ["index", "quickstart"] },
            { group: "Deep", pages: ["a", { group: "Nested", pages: ["b"] }] },
          ],
        },
        { tab: "API", groups: [{ group: "Ref", pages: ["api/x"] }] },
      ],
    };
    expect(summarizeNavigation(nav)).toEqual({ tabs: 2, groups: 4, pages: 5 });
  });

  it("handles a bare groups list, a bare pages list, and nothing at all", () => {
    expect(summarizeNavigation({ groups: [{ group: "G", pages: ["a", "b"] }] })).toEqual({
      tabs: 0,
      groups: 1,
      pages: 2,
    });
    expect(summarizeNavigation({ pages: ["a"] })).toEqual({ tabs: 0, groups: 0, pages: 1 });
    expect(summarizeNavigation({})).toEqual({ tabs: 0, groups: 0, pages: 0 });
    expect(summarizeNavigation(undefined)).toEqual({ tabs: 0, groups: 0, pages: 0 });
  });
});

describe("the drawer's schema", () => {
  // Keyed by the FULL path: `colors.primary` (a hex string) and `navbar.primary` (a label+href
  // pair) share a last segment, so matching on the suffix tests the wrong shape.
  const SAMPLES: Record<string, unknown> = {
    "appearance.default": "dark",
    "appearance.strict": true,
    "banner.dismissible": true,
    "banner.type": "warning",
    "navbar.links": [{ label: "L", href: "https://x.dev" }],
    "navbar.primary": { label: "L", href: "https://x.dev" },
    "seo.indexing": "all",
    "seo.metatags": { "og:image": "https://x.dev/og.png" },
  };

  it("round-trips every field this renderer reads through the typed parser", () => {
    // A field the drawer claims we RENDER has to survive `docsConfigSchema` — if the parser drops
    // or defaults it, the drawer is promising an effect that never happens. (Fields marked
    // `rendered: false` deliberately fail this: they're passthrough keys, covered below.)
    for (const path of renderedFieldPaths()) {
      const sample = SAMPLES[path.join(".")] ?? "value";
      const config = setAtPath({ banner: { content: "hi" } }, path, sample);
      const parsed = docsConfigSchema.parse(config);
      expect(getAtPath(parsed, path), `docs.json ${path.join(".")} did not survive parsing`).toEqual(sample);
    }
  });

  it("preserves every unrendered field it writes, and warns rather than dropping it", () => {
    // The other half of the deal: a key we don't render must still come back out of the parser
    // untouched (the passthrough promise), and must show up in `warnings` so an operator reading
    // the CLI/dashboard sees it's inert here rather than believing it took effect.
    const unrendered = allFieldPaths().filter(
      (p) => !renderedFieldPaths().some((r) => r.join(".") === p.join(".")),
    );
    expect(unrendered.length, "the drawer should still be offering passthrough keys").toBeGreaterThan(0);

    for (const path of unrendered) {
      const sample = SAMPLES[path.join(".")] ?? "value";
      const config = setAtPath({}, path, sample);
      const { config: parsed } = parseDocsConfig(config);
      expect(getAtPath(parsed, path), `docs.json ${path.join(".")} was dropped, not passed through`).toEqual(
        sample,
      );
    }

    // One config carrying every unrendered key: each top-level block is named once in warnings.
    let all: unknown = { name: "Docs" };
    for (const path of unrendered) all = setAtPath(all, path, SAMPLES[path.join(".")] ?? "value");
    const { warnings } = parseDocsConfig(all);
    const named = warnings.join(" ");
    for (const top of new Set(unrendered.map((p) => p[0]))) {
      // `seo`, `markdown`, `footer` etc. are already in the parser's KNOWN list (modelled at the
      // top level, or accepted as a passthrough object), so only genuinely unknown top-level keys
      // are expected to be named. `footer` is the interesting one: known to the parser, read by
      // nothing — which is exactly what the field-level mark is for.
      const knownToParser = ["seo", "markdown", "banner", "navbar", "colors", "appearance", "navigation", "footer"];
      if (knownToParser.includes(top)) continue;
      expect(named, `${top} should be reported as unsupported`).toContain(top);
    }
  });

  it("warns about nothing among the keys it renders", () => {
    // A "supported" key missing from the parser's KNOWN list makes the drawer look like it's
    // corrupting the file — `banner` did exactly that, rendering fine while logging "Unsupported
    // docs.json keys (ignored): banner" on every read.
    let config: unknown = { name: "Docs", banner: { content: "hi" } };
    for (const path of renderedFieldPaths()) config = setAtPath(config, path, SAMPLES[path.join(".")] ?? "value");
    const { warnings } = parseDocsConfig(config);
    expect(warnings).toEqual([]);
  });

  it("gives every field a unique path and every section an id", () => {
    const keys = allFieldPaths().map((p) => p.join("."));
    expect(new Set(keys).size).toBe(keys.length);
    const ids = CONFIG_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // A section with no fields must declare a custom renderer, or it shows as an empty heading.
    for (const s of CONFIG_SECTIONS) {
      expect(s.fields.length > 0 || s.custom, `section ${s.id} renders nothing`).toBeTruthy();
      // Marking a field inside an already-marked section double-labels the same fact.
      if (s.rendered === false) {
        for (const f of s.fields) {
          expect(f.rendered, `${s.id}.${f.path.join(".")} is marked inside a marked section`).toBeUndefined();
        }
      }
      // A select/multiselect with no options is an empty dropdown.
      for (const f of s.fields) {
        if (f.kind === "select" || f.kind === "multiselect") {
          expect(f.options?.length, `${s.id}.${f.path.join(".")} has no options`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("covers the whole docs.json surface the settings drawer is expected to expose", () => {
    // The sections the design calls for. Listed here so dropping one is a test failure rather than
    // something nobody notices until a customer looks for it.
    const expected = [
      "general",
      "navigation",
      "branding",
      "styling",
      "typography",
      "navbar",
      "footer",
      "banner",
      "content",
      "codeblocks",
      "context-menu",
      "navigation-behavior",
      "search",
      "api",
      "redirects",
      "seo",
      "thumbnails",
      "analytics",
      "errors",
      "variables",
    ];
    expect(CONFIG_SECTIONS.map((s) => s.id)).toEqual(expected);
  });
});
