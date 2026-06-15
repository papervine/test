import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getRef,
  createBranch,
  commitFiles,
  updateRef,
  openPullRequest,
} from "@/lib/github";

// A tiny fetch stub: maps "METHOD url" → a queued Response. Records calls so we can
// assert the exact Git Data API sequence/body the write client emits.
type Call = { url: string; method: string; body?: unknown };

function stubFetch(handler: (call: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    const { status = 200, json, text } = handler({ url, method, body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => text ?? (json ? JSON.stringify(json) : ""),
    } as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getRef", () => {
  it("resolves a branch's commit sha and tree sha", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.includes("/git/ref/heads/")) return { json: { object: { sha: "commit1" } } };
      if (url.includes("/git/commits/commit1")) return { json: { tree: { sha: "tree1" } } };
      return { status: 404 };
    });
    const ref = await getRef("o", "r", "main", "tok");
    expect(ref).toEqual({ commitSha: "commit1", treeSha: "tree1" });
    expect(calls[0].url).toContain("/repos/o/r/git/ref/heads/main");
    expect((calls[0] as { url: string } & { method: string }).method).toBe("GET");
  });

  it("keeps slashes literal in a namespaced branch ref", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.includes("/git/ref/heads/")) return { json: { object: { sha: "c" } } };
      return { json: { tree: { sha: "t" } } };
    });
    await getRef("o", "r", "papervine/edit-ab12", "tok");
    expect(calls[0].url).toContain("/git/ref/heads/papervine/edit-ab12");
    expect(calls[0].url).not.toContain("%2F");
  });

  it("returns null when the branch is missing", async () => {
    stubFetch(() => ({ status: 404 }));
    expect(await getRef("o", "r", "nope")).toBeNull();
  });
});

describe("createBranch", () => {
  it("POSTs a new ref at the base sha", async () => {
    const calls = stubFetch(() => ({ status: 201, json: {} }));
    const res = await createBranch("o", "r", "feature/x", "basesha", "tok");
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/repos/o/r/git/refs");
    expect(calls[0].body).toEqual({ ref: "refs/heads/feature/x", sha: "basesha" });
  });

  it("swallows a 422 'Reference already exists' as success", async () => {
    stubFetch(() => ({ status: 422, text: "Reference already exists" }));
    const res = await createBranch("o", "r", "dup", "sha");
    expect(res).toEqual({ ok: true, alreadyExists: true });
  });

  it("reports other failures", async () => {
    stubFetch(() => ({ status: 500, text: "boom" }));
    const res = await createBranch("o", "r", "b", "sha");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("500");
  });
});

describe("commitFiles", () => {
  it("creates a tree then a commit and returns the new sha", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/git/trees")) return { json: { sha: "newtree" } };
      if (url.endsWith("/git/commits")) return { json: { sha: "newcommit" } };
      return { status: 404 };
    });
    const res = await commitFiles("o", "r", {
      baseCommitSha: "base",
      baseTreeSha: "basetree",
      files: [
        { path: "a.mdx", content: "# A" },
        { path: "gone.mdx", content: null },
      ],
      message: "edit",
      token: "tok",
    });
    expect(res).toEqual({ commitSha: "newcommit" });
    expect(calls[0].body).toEqual({
      base_tree: "basetree",
      tree: [
        { path: "a.mdx", mode: "100644", type: "blob", content: "# A" },
        { path: "gone.mdx", mode: "100644", type: "blob", sha: null },
      ],
    });
    expect(calls[1].body).toEqual({ message: "edit", tree: "newtree", parents: ["base"] });
  });

  it("is a no-op error when there are no changes", async () => {
    stubFetch(() => ({ json: {} }));
    const res = await commitFiles("o", "r", {
      baseCommitSha: "b",
      baseTreeSha: "t",
      files: [],
      message: "m",
    });
    expect(res).toEqual({ error: "commitFiles: no changes" });
  });
});

describe("updateRef", () => {
  it("PATCHes the branch ref with force=false by default", async () => {
    const calls = stubFetch(() => ({ json: {} }));
    const res = await updateRef("o", "r", "main", "newsha", "tok");
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/git/refs/heads/main");
    expect(calls[0].body).toEqual({ sha: "newsha", force: false });
  });

  it("passes force through when asked", async () => {
    const calls = stubFetch(() => ({ json: {} }));
    await updateRef("o", "r", "main", "s", "tok", { force: true });
    expect((calls[0].body as { force: boolean }).force).toBe(true);
  });

  it("surfaces a non-fast-forward rejection", async () => {
    stubFetch(() => ({ status: 422, text: "Update is not a fast forward" }));
    const res = await updateRef("o", "r", "main", "s");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("422");
  });
});

describe("openPullRequest", () => {
  it("opens a PR and returns its number + url", async () => {
    const calls = stubFetch(() => ({ json: { number: 7, html_url: "https://gh/pr/7" } }));
    const res = await openPullRequest("o", "r", {
      head: "feature/x",
      base: "main",
      title: "Docs edit",
      token: "tok",
    });
    expect(res).toEqual({ number: 7, url: "https://gh/pr/7" });
    expect(calls[0].url).toContain("/repos/o/r/pulls");
    expect(calls[0].body).toMatchObject({ head: "feature/x", base: "main", title: "Docs edit" });
  });

  it("returns the existing PR on a 422 'already exists'", async () => {
    stubFetch(({ url, method }) => {
      if (method === "POST") return { status: 422, text: "A pull request already exists" };
      // the follow-up list call
      if (url.includes("/pulls?")) return { json: [{ number: 3, html_url: "https://gh/pr/3" }] };
      return { status: 404 };
    });
    const res = await openPullRequest("o", "r", { head: "dup", base: "main", title: "t" });
    expect(res).toEqual({ number: 3, url: "https://gh/pr/3" });
  });
});
