import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level vars, so the shared state these factories close over
// must be created with vi.hoisted (also hoisted), not plain consts.
const { git, store, appConfigured, runSync } = vi.hoisted(() => ({
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
}));

vi.mock("../../src/lib/github", () => git);
vi.mock("../../src/lib/draft-store", () => ({
  findOpenSession: vi.fn(async () => store.session),
  listDraftFiles: vi.fn(async () => store.drafts),
  closeSession: vi.fn(async () => {}),
  // unused by publishDraft but imported by the module under test:
  listOpenSessions: vi.fn(),
  createSession: vi.fn(),
  upsertDraftFile: vi.fn(),
}));
vi.mock("../../src/lib/github-token", () => ({ repoTokenForSite: vi.fn(async () => "tok") }));
vi.mock("../../src/lib/github-app", () => ({ isGithubAppConfigured: () => appConfigured.value }));
vi.mock("../../src/lib/sync-runner", () => ({ runSync }));

import { publishDraft } from "../../src/lib/authoring-core";

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
    expect(git.openPullRequest).toHaveBeenCalledWith(
      "o",
      "r",
      expect.objectContaining({ head: "papervine/edit-x", base: "main" }),
    );
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
