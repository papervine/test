import { describe, it, expect } from "vitest";
import { planNativePublish, type DraftInput } from "../../src/lib/native-publish-plan";
import { TEXT_CONTENT_TYPE } from "../../src/lib/sync-plan";

// The pure brain of a Papervine-hosted publish (SPEC §10.11). Two things here really
// matter: the keys must land in the exact storage key space the renderer reads, and
// docs.json must be separated out so it can be written after the pages it references.

const SITE = "site_abc";
const draft = (path: string, content = "x", deleted = false): DraftInput => ({ path, content, deleted });

describe("planNativePublish", () => {
  it("writes keys as sites/{id}/{path}, with no docsPath prefix", () => {
    const plan = planNativePublish(SITE, [draft("guides/intro.mdx")], new Set());
    expect(plan.puts.map((p) => p.key)).toEqual(["sites/site_abc/guides/intro.mdx"]);
  });

  // The regression: publishing nav before the pages it points at leaves readers with
  // sidebar entries that 404 for the width of the write window.
  it("separates docs.json so it can be written after the pages", () => {
    const plan = planNativePublish(
      SITE,
      [draft("docs.json", "{}"), draft("index.mdx")],
      new Set(),
    );
    expect(plan.puts.map((p) => p.key)).toEqual(["sites/site_abc/index.mdx"]);
    expect(plan.configPuts.map((p) => p.key)).toEqual(["sites/site_abc/docs.json"]);
  });

  // s3Source falls back to mint.json, so it gates navigation exactly like docs.json does.
  it("treats mint.json as config too", () => {
    const plan = planNativePublish(SITE, [draft("mint.json", "{}")], new Set());
    expect(plan.configPuts).toHaveLength(1);
    expect(plan.puts).toHaveLength(0);
  });

  it("turns tombstones into deletes rather than writes", () => {
    const plan = planNativePublish(
      SITE,
      [draft("old.mdx", "", true), draft("kept.mdx")],
      new Set(["sites/site_abc/old.mdx"]),
    );
    expect(plan.deletes).toEqual(["sites/site_abc/old.mdx"]);
    expect(plan.puts.map((p) => p.key)).toEqual(["sites/site_abc/kept.mdx"]);
    expect(plan.removed).toBe(1);
  });

  // The draft buffer is text-only, and syncSite stores repo text files (docs.json
  // included) under the same type — so storage written by a hosted publish is
  // indistinguishable from storage written by a sync.
  it("stores every file under the shared text content type", () => {
    const plan = planNativePublish(
      SITE,
      [draft("a.mdx"), draft("b.md"), draft("docs.json", "{}")],
      new Set(),
    );
    for (const write of [...plan.puts, ...plan.configPuts]) {
      expect(write.contentType).toBe(TEXT_CONTENT_TYPE);
    }
  });

  describe("the Activity-feed counters", () => {
    it("counts a file already in storage as modified, a new one as added", () => {
      const plan = planNativePublish(
        SITE,
        [draft("existing.mdx"), draft("brand-new.mdx")],
        new Set(["sites/site_abc/existing.mdx"]),
      );
      expect(plan.modified).toBe(1);
      expect(plan.added).toBe(1);
    });

    it("counts the config write like any other file", () => {
      const plan = planNativePublish(SITE, [draft("docs.json", "{}")], new Set());
      expect(plan.added).toBe(1);
    });

    // Deleting a draft page that was never published is not a change to the live site, so
    // it shouldn't show up as a removal in the feed.
    it("ignores a tombstone for a page that was never published", () => {
      const plan = planNativePublish(SITE, [draft("never-live.mdx", "", true)], new Set());
      expect(plan.deletes).toHaveLength(1);
      expect(plan.removed).toBe(0);
    });
  });

  it("plans nothing for an empty draft set", () => {
    const plan = planNativePublish(SITE, [], new Set());
    expect(plan).toEqual({
      puts: [],
      copies: [],
      configPuts: [],
      deletes: [],
      added: 0,
      modified: 0,
      removed: 0,
    });
  });

  describe("uploaded assets", () => {
    const upload = { path: "videos/demo.mp4", content: "", deleted: false, binary: true };

    it("copies from the session's draft prefix instead of writing content", () => {
      const plan = planNativePublish(SITE, [upload], new Set(), "sess1");
      // No put: the bytes never entered Postgres, so there is nothing to write.
      expect(plan.puts).toEqual([]);
      expect(plan.copies).toEqual([
        { from: "drafts/sess1/videos/demo.mp4", to: `sites/${SITE}/videos/demo.mp4` },
      ]);
      expect(plan.added).toBe(1);
    });

    it("counts a re-upload of a published path as modified", () => {
      const plan = planNativePublish(SITE, [upload], new Set([`sites/${SITE}/videos/demo.mp4`]), "sess1");
      expect(plan.modified).toBe(1);
      expect(plan.added).toBe(0);
    });

    it("skips the asset entirely with no session id, rather than writing an empty object", () => {
      // The source key is unaddressable without it, and putting `content: ""` would replace a
      // real published video with a zero-byte file — far worse than leaving the old one.
      const plan = planNativePublish(SITE, [upload], new Set(), undefined);
      expect(plan.puts).toEqual([]);
      expect(plan.copies).toEqual([]);
      expect(plan.added).toBe(0);
    });

    it("still deletes a tombstoned asset", () => {
      const plan = planNativePublish(
        SITE,
        [{ ...upload, deleted: true }],
        new Set([`sites/${SITE}/videos/demo.mp4`]),
        "sess1",
      );
      expect(plan.deletes).toEqual([`sites/${SITE}/videos/demo.mp4`]);
      expect(plan.removed).toBe(1);
    });
  });
});
