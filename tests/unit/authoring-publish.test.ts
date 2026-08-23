import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level vars, so the shared state these factories close over
// must be created with vi.hoisted (also hoisted), not plain consts.
const { git, store, appConfigured, runSync, publishNative, createSession } = vi.hoisted(() => ({
  git: {
    getRef: vi.fn(),
    commitFiles: vi.fn(),
    createBranch: vi.fn(),
    updateRef: vi.fn(),
    openPullRequest: vi.fn(),
  },
  store: {
    session: null as null | { id: string; baseBranch: string; baseCommitSha: string | null },
    drafts: [] as Array<{ path: string; content: string; deleted: boolean }>,
  },
  appConfigured: { value: true },
  runSync: vi.fn(async () => ({})),
  publishNative: vi.fn(async () => ({
    ok: true as const,
    mode: "native" as const,
    files: 1,
    deploymentId: "dep_native",
  })),
  createSession: vi.fn(async () => ({ id: "sess-new" })),
}));

vi.mock("../../src/lib/github", () => git);
vi.mock("../../src/lib/draft-store", () => ({
  findOpenSession: vi.fn(async () => store.session),
  listDraftFiles: vi.fn(async () => store.drafts),
  closeSession: vi.fn(async () => {}),
  createSession,
  // unused by publishDraft but imported by the module under test:
  listOpenSessions: vi.fn(),
  upsertDraftFile: vi.fn(),
}));
// The hosted publisher is exercised by native-publish.test.ts; here we only assert that
// publishDraft DISPATCHES to it (and that GitHub stays untouched when it does).
vi.mock("../../src/lib/native-publish", () => ({ publishNative }));
vi.mock("../../src/lib/github-token", () => ({ repoTokenForSite: vi.fn(async () => "tok") }));
vi.mock("../../src/lib/github-app", () => ({ isGithubAppConfigured: () => appConfigured.value }));
vi.mock("../../src/lib/sync-runner", () => ({ runSync }));

import { publishDraft, checkoutBranch } from "../../src/lib/authoring-core";

type Site = Parameters<typeof publishDraft>[0];
const site = {
  id: "s1",
  repoOwner: "o",
  repoName: "r",
  branch: "main",
  docsPath: "",
} as unknown as Site;

beforeEach(() => {
  vi.clearAllMocks();
  appConfigured.value = true;
  store.session = { id: "sess1", baseBranch: "main", baseCommitSha: "base1" };
  store.drafts = [{ path: "guides/intro.mdx", content: "# Hi", deleted: false }];
  git.getRef.mockResolvedValue({ commitSha: "base1", treeSha: "tree1" });
  git.commitFiles.mockResolvedValue({ commitSha: "newc" });
  git.updateRef.mockResolvedValue({ ok: true });
  git.createBranch.mockResolvedValue({ ok: true });
  git.openPullRequest.mockResolvedValue({ number: 5, url: "https://gh/pr/5" });
});

describe("publishDraft — commit mode", () => {
  it("commits the drafts and moves the deploy branch", async () => {
    const res = await publishDraft(site, "papervine/edit-x", { mode: "commit" });
    expect(res).toEqual({ ok: true, mode: "commit", commitSha: "newc" });
    expect(git.commitFiles).toHaveBeenCalledWith(
      "o",
      "r",
      expect.objectContaining({ baseCommitSha: "base1", baseTreeSha: "tree1" }),
    );
    expect(git.updateRef).toHaveBeenCalledWith("o", "r", "main", "newc", "tok");
    expect(runSync).not.toHaveBeenCalled(); // App configured → webhook owns the sync
  });

  it("syncs inline only when the GitHub App is not configured", async () => {
    appConfigured.value = false;
    await publishDraft(site, "br", { mode: "commit" });
    expect(runSync).toHaveBeenCalledOnce();
  });

  it("re-adds docsPath to the committed file paths", async () => {
    const subdirSite = { ...site, docsPath: "docs" };
    await publishDraft(subdirSite, "br", { mode: "commit" });
    expect(git.commitFiles.mock.calls[0][2].files).toEqual([
      { path: "docs/guides/intro.mdx", content: "# Hi" },
    ]);
  });

  it("commits a deletion as a null-content file change", async () => {
    store.drafts = [{ path: "old.mdx", content: "", deleted: true }];
    await publishDraft(site, "br", { mode: "commit" });
    expect(git.commitFiles.mock.calls[0][2].files).toEqual([{ path: "old.mdx", content: null }]);
  });
});

describe("publishDraft — pr mode", () => {
  it("creates the branch, commits, and opens a PR", async () => {
    const res = await publishDraft(site, "papervine/edit-x", { mode: "pr" });
    expect(res).toEqual({ ok: true, mode: "pr", prUrl: "https://gh/pr/5", prNumber: 5 });
    expect(git.createBranch).toHaveBeenCalledWith("o", "r", "papervine/edit-x", "base1", "tok");
    // A fresh branch is created at the deploy base, so the commit parents on the base.
    expect(git.commitFiles.mock.calls[0][2]).toMatchObject({ baseCommitSha: "base1", baseTreeSha: "tree1" });
    expect(git.openPullRequest).toHaveBeenCalledWith(
      "o",
      "r",
      expect.objectContaining({ head: "papervine/edit-x", base: "main" }),
    );
  });

  it("re-publish onto an EXISTING branch commits on the branch tip, not the deploy base", async () => {
    // The working branch already exists and is ahead of the deploy base (a prior publish advanced
    // it). Basing the commit on the deploy base would fork a sibling → updateRef 422 "not a fast
    // forward". We must read the branch tip and commit on top of it. getRef is called twice: the
    // deploy branch (concurrency check) then the working branch (its tip).
    git.createBranch.mockResolvedValue({ ok: true, alreadyExists: true });
    git.getRef
      .mockResolvedValueOnce({ commitSha: "base1", treeSha: "tree1" }) // deploy branch
      .mockResolvedValueOnce({ commitSha: "branchTip", treeSha: "branchTree" }); // the working branch

    const res = await publishDraft(site, "papervine/edit-x", { mode: "pr" });

    expect(res).toMatchObject({ ok: true, mode: "pr" });
    expect(git.commitFiles.mock.calls[0][2]).toMatchObject({
      baseCommitSha: "branchTip",
      baseTreeSha: "branchTree",
    });
    expect(git.updateRef).toHaveBeenCalledWith("o", "r", "papervine/edit-x", "newc", "tok");
  });
});

describe("publishDraft — guards", () => {
  it("returns a conflict (no commit) when the deploy branch moved", async () => {
    git.getRef.mockResolvedValue({ commitSha: "moved", treeSha: "t" });
    const res = await publishDraft(site, "br", { mode: "commit" });
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(git.commitFiles).not.toHaveBeenCalled();
  });

  it("is a no-op when there are no drafts", async () => {
    store.drafts = [];
    const res = await publishDraft(site, "br", { mode: "commit" });
    expect(res).toEqual({ ok: false, error: "No changes to publish." });
    expect(git.commitFiles).not.toHaveBeenCalled();
  });

  it("errors when there is no open session", async () => {
    store.session = null;
    const res = await publishDraft(site, "br", { mode: "commit" });
    expect(res.ok).toBe(false);
  });
});

// A Papervine-hosted site (SPEC §10.11) has no repo. The whole point of the dispatch is
// that GitHub is never reached — calling it with a null owner/name is the failure mode this
// guards, and it would surface as an opaque 404 from the GitHub API.
describe("publishDraft — Papervine-hosted dispatch", () => {
  const nativeSite = {
    ...site,
    sourceKind: "native",
    repoOwner: null,
    repoName: null,
  } as unknown as Site;

  it("hands off to the storage publisher and never touches GitHub", async () => {
    const res = await publishDraft(nativeSite, "main", { mode: "commit" });
    expect(res).toEqual({ ok: true, mode: "native", files: 1, deploymentId: "dep_native" });
    expect(publishNative).toHaveBeenCalledOnce();
    expect(git.getRef).not.toHaveBeenCalled();
    expect(git.commitFiles).not.toHaveBeenCalled();
    expect(git.openPullRequest).not.toHaveBeenCalled();
  });

  // The UI proposes a mode; the server decides. A stale client asking for a PR on a hosted
  // site must still publish, not error.
  it("ignores the requested mode, including 'pr'", async () => {
    await publishDraft(nativeSite, "papervine/edit-x", { mode: "pr" });
    expect(publishNative).toHaveBeenCalledOnce();
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("threads origin through, so an automation's publish can suppress the fan-out", async () => {
    await publishDraft(nativeSite, "main", { mode: "commit", origin: "automation" });
    expect(publishNative).toHaveBeenCalledWith(
      nativeSite,
      "main",
      expect.objectContaining({ origin: "automation" }),
    );
  });

  // A GIT site with empty repo columns is a failed connect, not a hosted site — it must
  // keep taking the git path (and failing loudly) rather than silently publishing nowhere.
  it("does not treat a repo-less GIT site as hosted", async () => {
    const brokenGit = { ...site, sourceKind: "git", repoOwner: null } as unknown as Site;
    await publishDraft(brokenGit, "main", { mode: "commit" });
    expect(publishNative).not.toHaveBeenCalled();
  });
});

describe("checkoutBranch", () => {
  // No open session for this branch yet — otherwise checkoutBranch re-attaches to it and
  // returns before it ever needs a base commit.
  beforeEach(() => {
    store.session = null;
  });

  it("stamps the deploy head on a Git site, for the publish-time divergence check", async () => {
    await checkoutBranch(site, { branchName: "papervine/edit-x" });
    expect(git.getRef).toHaveBeenCalledWith("o", "r", "main", "tok");
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ baseCommitSha: "base1" }),
    );
  });

  // No repo means no head to read and nothing to diverge FROM (publish overwrites storage),
  // so calling getRef with a null owner would be a pointless failing GitHub round trip.
  it("skips GitHub entirely on a hosted site and records no base commit", async () => {
    const nativeSite = { ...site, sourceKind: "native", repoOwner: null, repoName: null } as unknown as Site;
    await checkoutBranch(nativeSite, { branchName: "papervine/edit-x" });
    expect(git.getRef).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ baseCommitSha: null }));
  });
});
