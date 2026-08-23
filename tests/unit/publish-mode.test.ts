import { describe, it, expect } from "vitest";
import {
  publishModeFor,
  publishMenuModes,
  publishResultRef,
} from "../../src/lib/publish-mode";

// The editor opens on the deploy ("Default") branch (see editor/page.tsx), so the primary
// Publish action must commit straight to it — NOT open a PR from the deploy branch into
// itself (which createBranch would reject as already-existing). A working branch publishes
// as a PR. A Papervine-hosted site has no repo and publishes straight to live.
describe("publishModeFor", () => {
  it("commits when editing a Git site's deploy branch (the default editor landing)", () => {
    expect(publishModeFor({ gitBacked: true, branch: "main", deployBranch: "main" })).toBe("commit");
    expect(publishModeFor({ gitBacked: true, branch: "2.x", deployBranch: "2.x" })).toBe("commit");
  });

  it("opens a PR from a Git site's working branch", () => {
    expect(
      publishModeFor({ gitBacked: true, branch: "papervine/edit-1a2b3c4d", deployBranch: "main" }),
    ).toBe("pr");
  });

  // There is no PR target without a repo, so branch must not change the answer — a hosted
  // site's working branches are draft namespaces in Postgres, not git refs.
  it("publishes straight to live on a hosted site, whatever the branch", () => {
    expect(publishModeFor({ gitBacked: false, branch: "main", deployBranch: "main" })).toBe("native");
    expect(
      publishModeFor({ gitBacked: false, branch: "papervine/edit-1a2b3c4d", deployBranch: "main" }),
    ).toBe("native");
  });
});

describe("publishMenuModes", () => {
  it("offers both Git actions on a Git site", () => {
    expect(publishMenuModes(true)).toEqual(["pr", "commit"]);
  });

  // Offering "Open a pull request" on a hosted site would fail at the server dispatch —
  // publishDraft ignores the mode there entirely.
  it("offers nothing extra on a hosted site", () => {
    expect(publishMenuModes(false)).toEqual([]);
  });
});

describe("publishResultRef", () => {
  it("reports a commit by its sha and a PR by its URL", () => {
    expect(publishResultRef({ ok: true, mode: "commit", commitSha: "abc1234" })).toBe("abc1234");
    expect(
      publishResultRef({ ok: true, mode: "pr", prUrl: "https://github.com/a/b/pull/7", prNumber: 7 }),
    ).toBe("https://github.com/a/b/pull/7");
  });

  // A hosted publish has no commit and no PR, so there is genuinely no external reference
  // to record — the deployment row is the record. Null, never a fabricated sha.
  it("has no external reference for a hosted publish", () => {
    expect(
      publishResultRef({ ok: true, mode: "native", files: 3, deploymentId: "dep_1" }),
    ).toBeNull();
  });
});
