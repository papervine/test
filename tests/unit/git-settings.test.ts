import { describe, it, expect } from "vitest";
import { gitSettingsDirty, type GitConfig } from "../../src/lib/git-settings";

const base: GitConfig = {
  installationId: 42,
  owner: "acme",
  name: "platform",
  branch: "docs",
  docsPath: "docs",
};

describe("gitSettingsDirty", () => {
  it("is clean when nothing changed", () => {
    expect(gitSettingsDirty(base, { ...base })).toBe(false);
  });

  it("ignores cosmetic docsPath differences", () => {
    expect(gitSettingsDirty(base, { ...base, docsPath: "docs/" })).toBe(false);
    expect(gitSettingsDirty(base, { ...base, docsPath: " ./docs " })).toBe(false);
  });

  it("detects a real docsPath change", () => {
    expect(gitSettingsDirty(base, { ...base, docsPath: "" })).toBe(true);
    expect(gitSettingsDirty(base, { ...base, docsPath: "site/docs" })).toBe(true);
  });

  it("detects org / repo / branch changes", () => {
    expect(gitSettingsDirty(base, { ...base, installationId: 7 })).toBe(true);
    expect(gitSettingsDirty(base, { ...base, installationId: null })).toBe(true);
    expect(gitSettingsDirty(base, { ...base, owner: "other-org" })).toBe(true);
    expect(gitSettingsDirty(base, { ...base, name: "other" })).toBe(true);
    expect(gitSettingsDirty(base, { ...base, branch: "main" })).toBe(true);
  });
});
