import { describe, it, expect } from "vitest";
import { isSyncablePath, isAssetPath, mimeForPath, planSync, type Blob } from "@/lib/sync-plan";

describe("isSyncablePath", () => {
  it("keeps docs config, pages, and assets", () => {
    for (const p of ["docs.json", "mint.json", "guide/intro.mdx", "readme.md", "config.yaml", "logo.png", "demo.mp4", "spec.pdf"]) {
      expect(isSyncablePath(p)).toBe(true);
    }
  });
  it("drops source and unrelated files", () => {
    for (const p of ["src/index.ts", "package.json.lock", "Makefile", "scripts/build.sh"]) {
      // .lock / .sh / Makefile / .ts aren't doc or asset extensions
      expect(isSyncablePath(p)).toBe(false);
    }
  });
});

describe("isAssetPath / mimeForPath", () => {
  it("classifies binary assets vs text", () => {
    expect(isAssetPath("img/logo.svg")).toBe(true);
    expect(isAssetPath("guide/intro.mdx")).toBe(false);
  });
  it("infers content-type from extension, octet-stream as fallback", () => {
    expect(mimeForPath("a/b.png")).toBe("image/png");
    expect(mimeForPath("a/b.SVG")).toBe("image/svg+xml");
    expect(mimeForPath("a/b.unknownext")).toBe("application/octet-stream");
  });
});

describe("planSync", () => {
  const blobs: Blob[] = [
    { path: "docs.json", sha: "a" },
    { path: "intro.mdx", sha: "b" },
    { path: "img/logo.png", sha: "c" },
  ];

  it("fetches everything on a first sync (empty prior manifest)", () => {
    const plan = planSync(blobs, {});
    expect(plan.fetch.map((b) => b.path)).toEqual(["docs.json", "intro.mdx", "img/logo.png"]);
    expect(plan.manifest).toEqual({ "docs.json": "a", "intro.mdx": "b", "img/logo.png": "c" });
    expect(plan.stale).toEqual([]);
  });

  it("fetches only blobs whose SHA changed or are new", () => {
    const prior = { "docs.json": "a", "intro.mdx": "OLD" }; // logo.png is new, intro changed, docs.json same
    const plan = planSync(blobs, prior);
    expect(plan.fetch.map((b) => b.path).sort()).toEqual(["img/logo.png", "intro.mdx"]);
    expect(plan.stale).toEqual([]);
  });

  it("skips an unchanged sync entirely (no fetch, no stale)", () => {
    const prior = { "docs.json": "a", "intro.mdx": "b", "img/logo.png": "c" };
    const plan = planSync(blobs, prior);
    expect(plan.fetch).toEqual([]);
    expect(plan.stale).toEqual([]);
    expect(plan.manifest).toEqual(prior);
  });

  it("reports paths that vanished from the repo as stale", () => {
    const prior = { "docs.json": "a", "intro.mdx": "b", "old/removed.mdx": "z" };
    const plan = planSync(blobs, prior);
    expect(plan.stale).toEqual(["old/removed.mdx"]);
    expect(plan.fetch.map((b) => b.path)).toEqual(["img/logo.png"]); // only the new one
  });
});
