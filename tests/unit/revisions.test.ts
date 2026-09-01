import { describe, it, expect } from "vitest";
import {
  revisionPrefix,
  siteRevisionsPrefix,
  legacyPrefix,
  liveContentPrefix,
  contentVersion,
  isSidecarPath,
  isServableAssetPath,
  planRevisionWrite,
  planRevisionGc,
  canRollBack,
  isRolledBack,
  REVISIONS_PER_SITE,
} from "../../src/lib/revisions";

describe("prefixes", () => {
  it("puts revisions at a top-level prefix, never under the served sites/ tree", () => {
    // Load-bearing: the tenant-asset proxy serves {live prefix}{url segments}. If revisions
    // lived under sites/{id}/, every historical revision would be publicly fetchable —
    // including content someone rolled back specifically to remove.
    const prefix = revisionPrefix("site1", "rev1");
    expect(prefix).toBe("revs/site1/rev1/");
    expect(prefix.startsWith("sites/")).toBe(false);
    expect(siteRevisionsPrefix("site1")).toBe("revs/site1/");
  });

  it("serves the legacy flat prefix when a site has no revision yet", () => {
    // This null check IS the migration: pre-revision sites keep serving untouched.
    expect(liveContentPrefix({ id: "s1", liveRevisionId: null })).toBe("sites/s1/");
    expect(legacyPrefix("s1")).toBe("sites/s1/");
  });

  it("serves the revision prefix once a site has one", () => {
    expect(liveContentPrefix({ id: "s1", liveRevisionId: "r9" })).toBe("revs/s1/r9/");
  });
});

describe("contentVersion", () => {
  it("uses the revision id as the whole key", () => {
    expect(contentVersion({ id: "s1", liveRevisionId: "r9" })).toBe("r9");
  });

  it("falls back to sha:updatedAt for a legacy site", () => {
    const updatedAt = new Date("2026-09-01T00:00:00.000Z");
    expect(
      contentVersion({ id: "s1", liveRevisionId: null, lastSyncedCommitSha: "abc", updatedAt }),
    ).toBe(`abc:${updatedAt.getTime()}`);
  });

  it("normalizes the legacy key across Date, string and epoch inputs", () => {
    // The six inlined copies of this key had drifted — two used toISOString(), one dropped
    // updatedAt entirely. One function, one answer, whatever the row shape hands us.
    const iso = "2026-09-01T00:00:00.000Z";
    const ms = new Date(iso).getTime();
    const expected = `abc:${ms}`;
    expect(contentVersion({ id: "s", liveRevisionId: null, lastSyncedCommitSha: "abc", updatedAt: new Date(iso) })).toBe(expected);
    expect(contentVersion({ id: "s", liveRevisionId: null, lastSyncedCommitSha: "abc", updatedAt: iso })).toBe(expected);
    expect(contentVersion({ id: "s", liveRevisionId: null, lastSyncedCommitSha: "abc", updatedAt: ms })).toBe(expected);
  });

  it("tolerates a hosted site's null sha and a missing updatedAt", () => {
    expect(contentVersion({ id: "s1", liveRevisionId: null })).toBe(":0");
  });

  it("changes when the revision changes, so a deploy can't serve stale bytes", () => {
    expect(contentVersion({ id: "s1", liveRevisionId: "r1" })).not.toBe(
      contentVersion({ id: "s1", liveRevisionId: "r2" }),
    );
  });
});

describe("sidecar and asset-path guards", () => {
  it("treats dot-rooted bookkeeping files as sidecars", () => {
    expect(isSidecarPath(".manifest.json")).toBe(true);
    expect(isSidecarPath(".dimensions.json")).toBe(true);
    expect(isSidecarPath("guides/auth.mdx")).toBe(false);
  });

  it("refuses to serve sidecars or escaping segments through the asset proxy", () => {
    expect(isServableAssetPath("images/logo.png")).toBe(true);
    expect(isServableAssetPath(".manifest.json")).toBe(false);
    expect(isServableAssetPath("a/../b")).toBe(false);
    expect(isServableAssetPath("a//b")).toBe(false);
    expect(isServableAssetPath("")).toBe(false);
  });
});

describe("planRevisionWrite", () => {
  it("carries forward only what isn't being rewritten", () => {
    const { copies } = planRevisionWrite({
      fromPrefix: "revs/s1/r1/",
      toPrefix: "revs/s1/r2/",
      keep: ["index.mdx", "guides/auth.mdx", "images/logo.png"],
      written: ["guides/auth.mdx"],
    });
    expect(copies).toEqual([
      { from: "revs/s1/r1/index.mdx", to: "revs/s1/r2/index.mdx" },
      { from: "revs/s1/r1/images/logo.png", to: "revs/s1/r2/images/logo.png" },
    ]);
  });

  it("never copies a path that is also being written", () => {
    // The ordering bug this function exists to prevent: a copy landing after the put would
    // silently restore the old bytes into the new revision.
    const { copies } = planRevisionWrite({
      fromPrefix: "revs/s1/r1/",
      toPrefix: "revs/s1/r2/",
      keep: ["docs.json"],
      written: ["docs.json"],
    });
    expect(copies).toEqual([]);
  });

  it("drops files removed by this deploy", () => {
    const { copies } = planRevisionWrite({
      fromPrefix: "revs/s1/r1/",
      toPrefix: "revs/s1/r2/",
      keep: ["gone.mdx", "stays.mdx"],
      written: [],
      removed: ["gone.mdx"],
    });
    expect(copies).toEqual([{ from: "revs/s1/r1/stays.mdx", to: "revs/s1/r2/stays.mdx" }]);
  });

  it("copies nothing for a site's first revision", () => {
    expect(
      planRevisionWrite({ fromPrefix: null, toPrefix: "revs/s1/r1/", keep: ["x.mdx"], written: [] }).copies,
    ).toEqual([]);
  });

  it("carries sidecars forward like any other file", () => {
    // .manifest.json must ride along or the NEXT sync diffs against nothing and re-uploads
    // the world (or worse, skips files it should have written).
    const { copies } = planRevisionWrite({
      fromPrefix: "revs/s1/r1/",
      toPrefix: "revs/s1/r2/",
      keep: [".manifest.json"],
      written: [],
    });
    expect(copies).toEqual([
      { from: "revs/s1/r1/.manifest.json", to: "revs/s1/r2/.manifest.json" },
    ]);
  });
});

describe("planRevisionGc", () => {
  const ordered = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`); // newest first

  it("keeps the most recent N and prunes the rest", () => {
    const prune = planRevisionGc({ siteId: "s1", ordered: ordered(5), liveRevisionId: "r0", keep: 2 });
    // r0 is live (excluded from the count), then r1 + r2 fill the budget.
    expect(prune).toEqual(["revs/s1/r3/", "revs/s1/r4/"]);
  });

  it("never prunes the live revision, even when it is old", () => {
    // After a rollback the live revision is NOT the newest — pruning by age alone would
    // delete the tree currently being served.
    const prune = planRevisionGc({ siteId: "s1", ordered: ordered(6), liveRevisionId: "r5", keep: 2 });
    expect(prune).not.toContain("revs/s1/r5/");
    expect(prune).toEqual(["revs/s1/r2/", "revs/s1/r3/", "revs/s1/r4/"]);
  });

  it("prunes nothing when under the budget", () => {
    expect(planRevisionGc({ siteId: "s1", ordered: ordered(3), liveRevisionId: "r0" })).toEqual([]);
  });

  it("dedupes repeated revision ids", () => {
    // Several rollbacks to the same revision each have their own deployment row but share
    // one revision id; counting it twice would evict a revision we still hold.
    const prune = planRevisionGc({
      siteId: "s1",
      ordered: ["r0", "r0", "r1", "r2"],
      liveRevisionId: "r0",
      keep: 1,
    });
    expect(prune).toEqual(["revs/s1/r2/"]);
  });

  it("defaults to the documented retention", () => {
    expect(REVISIONS_PER_SITE).toBe(20);
    expect(planRevisionGc({ siteId: "s1", ordered: ordered(20), liveRevisionId: "r0" })).toEqual([]);
  });
});

describe("canRollBack", () => {
  const site = { liveRevisionId: "rLive" };

  it("allows a successful live deploy that produced another revision", () => {
    expect(canRollBack({ id: "d1", status: "successful", target: "live", revisionId: "rOld" }, site)).toBe(true);
  });

  it("refuses the revision already being served", () => {
    expect(canRollBack({ id: "d1", status: "successful", target: "live", revisionId: "rLive" }, site)).toBe(false);
  });

  it("refuses failed and building deploys", () => {
    expect(canRollBack({ id: "d", status: "failed", target: "live", revisionId: "rOld" }, site)).toBe(false);
    expect(canRollBack({ id: "d", status: "building", target: "live", revisionId: "rOld" }, site)).toBe(false);
  });

  it("refuses previews — they never pointed at the live site", () => {
    expect(canRollBack({ id: "d", status: "successful", target: "preview", revisionId: "rOld" }, site)).toBe(false);
  });

  it("refuses pre-revision rows, whose bytes we genuinely don't have", () => {
    expect(canRollBack({ id: "d", status: "successful", target: "live", revisionId: null }, site)).toBe(false);
  });

  it("treats a missing target as live, for rows written before the column", () => {
    expect(canRollBack({ id: "d", status: "successful", revisionId: "rOld" }, site)).toBe(true);
  });
});

describe("isRolledBack", () => {
  it("is true when the live revision is not the newest successful deploy", () => {
    const rows = [
      { id: "d2", status: "successful", target: "live", revisionId: "r2" },
      { id: "d1", status: "successful", target: "live", revisionId: "r1" },
    ];
    expect(isRolledBack({ liveRevisionId: "r1" }, rows)).toBe(true);
    expect(isRolledBack({ liveRevisionId: "r2" }, rows)).toBe(false);
  });

  it("ignores failed deploys when deciding what the newest is", () => {
    // A failed deploy never flipped the pointer, so serving the previous revision is the
    // normal state — not a rollback, and it must not raise the banner.
    const rows = [
      { id: "d2", status: "failed", target: "live", revisionId: null },
      { id: "d1", status: "successful", target: "live", revisionId: "r1" },
    ];
    expect(isRolledBack({ liveRevisionId: "r1" }, rows)).toBe(false);
  });

  it("is false for a legacy site with no revision", () => {
    expect(isRolledBack({ liveRevisionId: null }, [])).toBe(false);
  });

  // THE subtlety. A rollback row records the revision it RESTORED, so if it counted as the
  // newest deployment it would match the live pointer by construction — and the banner would
  // switch off at exactly the moment it should switch on.
  it("ignores rollback rows when deciding what the newest deployment is", () => {
    const rows = [
      { id: "d3", status: "successful", target: "live", trigger: "rollback", revisionId: "r1" },
      { id: "d2", status: "successful", target: "live", trigger: "webhook", revisionId: "r2" },
      { id: "d1", status: "successful", target: "live", trigger: "webhook", revisionId: "r1" },
    ];
    expect(isRolledBack({ liveRevisionId: "r1" }, rows)).toBe(true);
  });

  it("clears once a real deploy lands on top of a rollback", () => {
    const rows = [
      { id: "d4", status: "successful", target: "live", trigger: "webhook", revisionId: "r3" },
      { id: "d3", status: "successful", target: "live", trigger: "rollback", revisionId: "r1" },
      { id: "d2", status: "successful", target: "live", trigger: "webhook", revisionId: "r2" },
    ];
    expect(isRolledBack({ liveRevisionId: "r3" }, rows)).toBe(false);
  });
});

describe("canRollBack after a rollback", () => {
  // The rollback row itself points at the revision now being served, so it must not offer to
  // restore what's already live — but the deployment it superseded must still be offered, so
  // you can roll forward again.
  it("offers the superseded deployment, not the rollback row", () => {
    const site = { liveRevisionId: "r1" };
    const rollbackRow = { id: "d3", status: "successful", target: "live", revisionId: "r1" };
    const supersededRow = { id: "d2", status: "successful", target: "live", revisionId: "r2" };
    expect(canRollBack(rollbackRow, site)).toBe(false);
    expect(canRollBack(supersededRow, site)).toBe(true);
  });
});
