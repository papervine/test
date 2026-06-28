import { describe, it, expect, vi, beforeEach } from "vitest";

// The bug: a GitHub push syncs fresh content to storage, but the docs site kept serving
// the old copy. The render path reads through `unstable_cache`, and invalidation relied on
// `revalidateTag` — which doesn't propagate from the webhook's `after()` callback. The fix
// stamps the synced commit sha into the cache KEY, so a new sync serves fresh content with
// no revalidation needed. This test guards that contract: the version is in every key, and
// a new sha yields different keys than the previous one.

// `unstable_cache`'s keyParts array IS the cache identity — capture it.
const keyParts: string[][] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown, keys: string[]) => {
    keyParts.push(keys);
    return fn;
  },
  revalidateTag: vi.fn(),
}));

// Storage reads are irrelevant to the key contract.
vi.mock("../../src/lib/storage", () => ({
  getObjectText: vi.fn(async () => "{}"),
  listKeys: vi.fn(async () => []),
}));

import { s3Source, isSynced } from "../../src/lib/s3-source";

beforeEach(() => {
  keyParts.length = 0;
});

describe("s3Source content cache is version-keyed", () => {
  it("includes the sync version in every cache key", () => {
    s3Source("site1", "shaA");
    expect(keyParts.map((k) => k[0])).toEqual([
      "s3-config",
      "s3-page",
      "s3-keys",
      "s3-dimensions",
      "s3-raw",
    ]);
    for (const k of keyParts) expect(k).toContain("shaA");
  });

  it("a new sync (new sha) produces different keys than the previous sync", () => {
    s3Source("site1", "shaA");
    const before = keyParts.map((k) => k.join("|"));
    keyParts.length = 0;
    s3Source("site1", "shaB");
    const after = keyParts.map((k) => k.join("|"));
    expect(after).not.toEqual(before);
  });

  it("isSynced is version-keyed too, so a first sync isn't masked by a cached false", async () => {
    await isSynced("site1", "shaA");
    expect(keyParts[0]).toEqual(["s3-config", "site1", "shaA"]);
  });
});
