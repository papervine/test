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

// Agent-native parity cuts both ways: the agent should see the capabilities the site
// actually has, and no more. On a Papervine-hosted site (SPEC §10.11) there is no repo, so
// list_branches would call GitHub with a null owner, and a `mode: 'pr'` argument would be
// silently ignored by the server — better to never offer either.
describe("authoringTools — Papervine-hosted site", () => {
  const nativeSite = {
    id: "s1",
    sourceKind: "native",
    repoOwner: null,
    repoName: null,
    lastSyncedCommitSha: null,
  } as never;

  it("omits list_branches entirely", () => {
    expect(authoringTools(nativeSite, BRANCH).list_branches).toBeUndefined();
    expect(authoringTools(site, BRANCH).list_branches).toBeDefined();
  });

  it("keeps every source-agnostic tool", () => {
    const tools = authoringTools(nativeSite, BRANCH);
    for (const name of ["write_page", "edit_page", "delete_page", "checkout", "publish", "discard"]) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("still publishes, without being offered a pull-request mode", async () => {
    const tools = authoringTools(nativeSite, BRANCH);
    await (tools.publish.execute as (i: unknown, o: unknown) => Promise<unknown>)(
      { message: "Ship it" },
      {},
    );
    expect(core.publishDraft).toHaveBeenCalledWith(nativeSite, BRANCH, {
      mode: "commit",
      message: "Ship it",
    });
  });

  // The schema is what the model can actually emit, so that's where "no PR mode" has to be
  // true — the description merely explains why. A Git site still offers both modes.
  it("offers no mode argument on a hosted site, but does on a Git site", () => {
    const shape = (site_: never) =>
      Object.keys(
        (authoringTools(site_, BRANCH).publish.inputSchema as unknown as { shape: object }).shape,
      );
    expect(shape(nativeSite)).toEqual(["message"]);
    expect(shape(site)).toContain("mode");
  });
});
