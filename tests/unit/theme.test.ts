import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  resolveTheme,
  themeCssVars,
  themes,
  type ThemeName,
  type ThemeTokens,
} from "../../packages/renderer/lib/theme";

const NAMES = Object.keys(themes) as ThemeName[];

describe("resolveTheme", () => {
  it("resolves every registered name", () => {
    for (const name of NAMES) expect(resolveTheme(name).name).toBe(name);
  });

  it("is case- and whitespace-insensitive, because docs.json is hand-written", () => {
    expect(resolveTheme("LINDEN").name).toBe("linden");
    expect(resolveTheme("  Sequoia  ").name).toBe("sequoia");
  });

  it("falls back to the default rather than throwing on an unknown or missing theme", () => {
    // A docs.json from a newer schema naming a theme we don't have must render, not 500 —
    // the config layer's warn-don't-throw rule applies to the theme value too.
    expect(resolveTheme("no-such-theme").name).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined).name).toBe(DEFAULT_THEME);
    expect(resolveTheme("").name).toBe(DEFAULT_THEME);
  });
});

describe("themeCssVars", () => {
  it("emits a variable for every token", () => {
    // The generator hand-writes its variable names, so a token added to the type without a
    // line in themeCssVars would be silently dead. This is what catches that.
    const tokenCount = Object.keys(themes[DEFAULT_THEME] as ThemeTokens).length;
    const declared = themeCssVars(themes[DEFAULT_THEME]).split(";").filter(Boolean);
    expect(declared).toHaveLength(tokenCount);
    for (const d of declared) expect(d).toMatch(/^--db-[a-z-]+:.+$/);
  });

  it("produces valid CSS for every theme — no empty values", () => {
    for (const name of NAMES) {
      for (const decl of themeCssVars(themes[name]).split(";")) {
        const [prop, ...rest] = decl.split(":");
        expect(prop, `${name}: empty property`).toBeTruthy();
        expect(rest.join(":").trim(), `${name}: ${prop} has no value`).not.toBe("");
      }
    }
  });
});

describe("the registry itself", () => {
  it("gives every theme the full token set", () => {
    const keys = Object.keys(themes[DEFAULT_THEME]).sort();
    for (const name of NAMES) expect(Object.keys(themes[name]).sort(), name).toEqual(keys);
  });

  it("keeps the themes visually distinct from one another", () => {
    // Nine names that render identically is the bug this registry was rewritten to fix: they
    // used to differ only in font stack and two radii, so most pairs were indistinguishable.
    // Every pair must now differ in at least two tokens.
    const tooSimilar: string[] = [];
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const a = themes[NAMES[i]] as Record<string, string>;
        const b = themes[NAMES[j]] as Record<string, string>;
        const diffs = Object.keys(a).filter((k) => a[k] !== b[k]);
        if (diffs.length < 2) tooSimilar.push(`${NAMES[i]}/${NAMES[j]} differ only in ${diffs}`);
      }
    }
    expect(tooSimilar).toEqual([]);
  });

  it("uses only offline-safe font stacks", () => {
    // Themes must render identically without a network — `papervine dev` has no chance to
    // fetch a webfont at render time, and a docs site shouldn't shift layout on a cold cache.
    for (const name of NAMES) {
      const t = themes[name];
      for (const stack of [t.fontSans, t.fontMono, t.fontDisplay]) {
        expect(stack, name).not.toMatch(/url\(|https?:|@import/);
        // Every stack ends in a generic family, so an exotic first choice always has a floor.
        expect(stack, name).toMatch(/(sans-serif|serif|monospace|system-ui)\s*$/);
      }
    }
  });
});
