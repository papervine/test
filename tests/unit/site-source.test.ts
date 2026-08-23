import { describe, it, expect } from "vitest";
import { isNativeSite, hasGitRepo, hasRenderableSource } from "../../src/lib/site-source";

// The one dispatch seam for Papervine-hosted sites (SPEC §10.11). Every repo-shaped
// surface reads one of these three, so a wrong answer here either 500s a native site
// (GitHub called with a null owner) or hides working controls on a git site.

const git = { sourceKind: "git", repoOwner: "acme", repoName: "docs" };
const native = { sourceKind: "native", repoOwner: null, repoName: null };
// A row written before the migration added the column, still git-backed.
const legacy = { sourceKind: null, repoOwner: "acme", repoName: "docs" };
// A git site whose connect never completed — no repo to act on.
const halfConnected = { sourceKind: "git", repoOwner: "acme", repoName: null };

describe("isNativeSite", () => {
  it("is true only for the literal 'native'", () => {
    expect(isNativeSite(native)).toBe(true);
    expect(isNativeSite(git)).toBe(false);
  });

  // Forward/backward compatibility: an absent column (older row) or a value a NEWER
  // deploy invented must fall back to git — the safe direction, since git behavior is
  // what every existing site already gets.
  it("falls back to git for an absent or unknown kind", () => {
    expect(isNativeSite(legacy)).toBe(false);
    expect(isNativeSite({ repoOwner: "acme", repoName: "docs" })).toBe(false);
    expect(isNativeSite({ sourceKind: "upload", repoOwner: null, repoName: null })).toBe(false);
  });
});

describe("hasGitRepo", () => {
  it("is true for a git site with both repo columns set", () => {
    expect(hasGitRepo(git)).toBe(true);
    expect(hasGitRepo(legacy)).toBe(true);
  });

  it("is false for a git site missing either repo column", () => {
    expect(hasGitRepo(halfConnected)).toBe(false);
    expect(hasGitRepo({ sourceKind: "git", repoOwner: null, repoName: "docs" })).toBe(false);
    expect(hasGitRepo({ sourceKind: "git", repoOwner: null, repoName: null })).toBe(false);
  });

  // The discriminator wins over the columns. A native site that somehow carries repo
  // columns (a future git-upgrade flow writing them before flipping the kind) must still
  // hide repo controls, or Re-sync would overwrite its storage prefix from that repo.
  it("is false for a native site even when repo columns are populated", () => {
    expect(hasGitRepo({ sourceKind: "native", repoOwner: "acme", repoName: "docs" })).toBe(false);
  });
});

describe("hasRenderableSource", () => {
  // The regression this guards: request-source.ts used to gate on repoOwner/repoName
  // alone, so a native site rendered nothing anywhere — no docs, no editor, no preview.
  it("is true for a native site with no repo", () => {
    expect(hasRenderableSource(native)).toBe(true);
  });

  it("is true for a git site with a repo", () => {
    expect(hasRenderableSource(git)).toBe(true);
    expect(hasRenderableSource(legacy)).toBe(true);
  });

  it("is false for a git site with no repo attached", () => {
    expect(hasRenderableSource(halfConnected)).toBe(false);
  });
});
