import { describe, it, expect, vi, beforeEach } from "vitest";

const core = vi.hoisted(() => ({
  resolvePagePath: vi.fn(),
  saveDraft: vi.fn(async () => ({ ok: true })),
  publishDraft: vi.fn(async () => ({ ok: true, mode: "pr", prUrl: "u", prNumber: 1 })),
  checkoutBranch: vi.fn(async () => ({ branch: "papervine/edit-new", sessionId: "s" })),
  discardSession: vi.fn(async () => ({ ok: true })),
  listSessions: vi.fn(async () => [{ branch: "papervine/edit-x" }]),
}));
vi.mock("../../src/lib/authoring-core", () => core);
vi.mock("../../src/lib/draft-source", () => ({ draftSource: () => ({}) }));
vi.mock("../../src/lib/github", () => ({ listBranches: vi.fn(async () => ["main", "dev"]) }));
vi.mock("../../src/lib/github-token", () => ({ repoTokenForSite: vi.fn(async () => "tok") }));

import { authoringTools } from "../../src/lib/authoring-tools";

const site = { id: "s1", repoOwner: "o", repoName: "r", lastSyncedCommitSha: "sha" } as never;
const BRANCH = "papervine/edit-x";

// Call a tool's execute with just its input (the AI SDK passes an options arg we don't use).
const call = (name: string, input: unknown) =>
  (authoringTools(site, BRANCH)[name].execute as (i: unknown, o: unknown) => Promise<unknown>)(input, {});

beforeEach(() => {
  vi.clearAllMocks();
  core.resolvePagePath.mockResolvedValue({ path: "guides/intro.mdx", raw: "# Old" });
});

describe("authoringTools", () => {
  it("write_page saves the full content to the resolved path", async () => {
    await call("write_page", { slug: "guides/intro", content: "# New" });
    expect(core.saveDraft).toHaveBeenCalledWith(site, BRANCH, "guides/intro.mdx", "# New");
  });

  it("edit_page applies a find/replace to the raw content", async () => {
    await call("edit_page", { slug: "guides/intro", find: "Old", replace: "Fresh" });
    expect(core.saveDraft).toHaveBeenCalledWith(site, BRANCH, "guides/intro.mdx", "# Fresh");
  });

  it("edit_page errors when the text isn't found", async () => {
    const res = (await call("edit_page", { slug: "guides/intro", find: "ZZZ", replace: "x" })) as {
      error?: string;
    };
    expect(res.error).toMatch(/Couldn't find/);
    expect(core.saveDraft).not.toHaveBeenCalled();
  });

  it("edit_page errors on a missing page", async () => {
    core.resolvePagePath.mockResolvedValue({ path: "x.mdx", raw: null });
    const res = (await call("edit_page", { slug: "nope", find: "a", replace: "b" })) as {
      error?: string;
    };
    expect(res.error).toMatch(/No page/);
  });

  it("delete_page tombstones the page", async () => {
    await call("delete_page", { slug: "guides/intro" });
    expect(core.saveDraft).toHaveBeenCalledWith(site, BRANCH, "guides/intro.mdx", "", { deleted: true });
  });

  it("publish delegates to publishDraft with the mode", async () => {
    await call("publish", { mode: "pr", message: "ship it" });
    expect(core.publishDraft).toHaveBeenCalledWith(site, BRANCH, { mode: "pr", message: "ship it" });
  });

  it("checkout opens a new session", async () => {
    const res = (await call("checkout", {})) as { branch: string };
    expect(core.checkoutBranch).toHaveBeenCalled();
    expect(res.branch).toBe("papervine/edit-new");
  });

  it("list_branches combines git branches and edit sessions", async () => {
    const res = (await call("list_branches", {})) as {
      branches: string[];
      editSessions: string[];
      current: string;
    };
    expect(res.branches).toEqual(["main", "dev"]);
    expect(res.editSessions).toEqual(["papervine/edit-x"]);
    expect(res.current).toBe(BRANCH);
  });
});
