import { describe, it, expect } from "vitest";
import {
  isSyncablePath,
  isAssetPath,
  isRasterImagePath,
  mergeAssetDimensions,
  mimeForPath,
  planSync,
  type Blob,
} from "@/lib/sync-plan";

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

describe("isRasterImagePath", () => {
  it("matches the optimizer's raster set", () => {
    for (const p of ["img/a.png", "b.jpg", "c.JPEG", "d.webp", "e.avif", "f.bmp"]) {
      expect(isRasterImagePath(p)).toBe(true);
    }
  });
  it("excludes gif (animation), svg/ico (no raster dims), and non-images", () => {
    for (const p of ["anim.gif", "logo.svg", "fav.ico", "clip.mp4", "intro.mdx"]) {
      expect(isRasterImagePath(p)).toBe(false);
    }
  });
});

describe("mergeAssetDimensions", () => {
  const prior = {
    "a.png": { width: 10, height: 20 },
    "b.png": { width: 30, height: 40 },
    "gone.png": { width: 1, height: 1 },
  };

  it("carries forward untouched dims, drops stale paths", () => {
    const merged = mergeAssetDimensions(prior, [], {}, ["gone.png"]);
    expect(merged).toEqual({
      "a.png": { width: 10, height: 20 },
      "b.png": { width: 30, height: 40 },
    });
  });

  it("re-sets refetched images from freshly measured dims", () => {
    const merged = mergeAssetDimensions(prior, ["a.png"], { "a.png": { width: 99, height: 88 } }, []);
    expect(merged["a.png"]).toEqual({ width: 99, height: 88 });
    expect(merged["b.png"]).toEqual({ width: 30, height: 40 }); // untouched
  });

  it("invalidates a refetched image we could not measure (no stale wrong dims)", () => {
    // b.png changed but failed to measure → it must not keep its old dimensions.
    const merged = mergeAssetDimensions(prior, ["b.png"], {}, []);
    expect(merged).not.toHaveProperty("b.png");
    expect(merged["a.png"]).toEqual({ width: 10, height: 20 });
  });

  it("adds brand-new measured images on a first sync", () => {
    const merged = mergeAssetDimensions({}, ["new.png"], { "new.png": { width: 5, height: 6 } }, []);
    expect(merged).toEqual({ "new.png": { width: 5, height: 6 } });
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

  // Self-heal: the manifest claims everything is synced (SHAs all match), but storage is
  // MISSING intro.mdx. Manifest-only diffing would skip it forever (the drift bug — the
  // missing-workflows.md prod incident). With the `stored` set, the missing file is refetched.
  it("re-fetches a file the manifest claims but storage lacks (drift self-heal)", () => {
    const prior = { "docs.json": "a", "intro.mdx": "b", "img/logo.png": "c" }; // claims all synced
    const stored = new Set(["docs.json", "img/logo.png"]); // intro.mdx actually missing
    const plan = planSync(blobs, prior, stored);
    expect(plan.fetch.map((b) => b.path)).toEqual(["intro.mdx"]);
  });

  it("with a complete `stored` set, an unchanged sync is still a no-op", () => {
    const prior = { "docs.json": "a", "intro.mdx": "b", "img/logo.png": "c" };
    const stored = new Set(["docs.json", "intro.mdx", "img/logo.png"]);
    const plan = planSync(blobs, prior, stored);
    expect(plan.fetch).toEqual([]);
  });
});
