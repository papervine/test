// Minimal GitHub REST client for the connect-a-repo flow. Works for public repos
// unauthenticated (60 req/hr), and for **private** repos when handed a token — a
// fine-grained PAT today; a GitHub App installation token later (the App is the
// follow-up: install flow + token minting, plugging into this same `token` seam).
// A GITHUB_TOKEN env var, if present, is the default for public-repo calls (raises
// the rate limit); a per-site token always wins when supplied.
const API = "https://api.github.com";

// Accepts "owner/name", a github.com URL, or "owner/name.git". Pure — kept out of
// the "use server" actions file (which may only export async functions).
export function parseRepoInput(input: string): { owner: string; name: string } | null {
  const cleaned = input.trim().replace(/\.git$/, "");
  const m =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/) ?? cleaned.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

// Normalize a user-typed "docs.json is in a subdirectory" path into a clean,
// slash-delimited repo-relative prefix: trims, drops leading/trailing/`.` segments,
// strips `..` so it can't climb out, and collapses backslashes. "" → repo root.
// Pure — unit-tested alongside parseRepoInput.
export function normalizeDocsPath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

// Per-site `token` (private repos) takes precedence; otherwise fall back to the
// optional global GITHUB_TOKEN for public-repo rate limits.
export function ghHeaders(token?: string): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "papervine",
  };
  const auth = token ?? process.env.GITHUB_TOKEN;
  if (auth) headers.authorization = `Bearer ${auth}`;
  return headers;
}

// Same as ghHeaders but for JSON-body writes (POST/PATCH to the Git Data API).
function jsonHeaders(token?: string): Record<string, string> {
  return { ...(ghHeaders(token) as Record<string, string>), "content-type": "application/json" };
}

// A branch name may contain slashes (e.g. "papervine/edit-ab12"). Encode each segment
// but keep the slashes literal — the refs path is `…/git/refs/heads/{a}/{b}`, not a
// single encoded component (encodeURIComponent would turn "/" into "%2F" and 404).
function refPath(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

export type RepoMeta = { fullName: string; defaultBranch: string; private: boolean };

export async function fetchRepo(
  owner: string,
  name: string,
  token?: string,
): Promise<RepoMeta | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}`, { headers: ghHeaders(token) });
  if (!res.ok) return null;
  const data = await res.json();
  return { fullName: data.full_name, defaultBranch: data.default_branch, private: !!data.private };
}

// True if the repo has a Papervine/docs.json config on the given ref. `docsPath` is the
// normalized subdirectory the config lives in (see normalizeDocsPath); "" = repo root.
export async function hasDocsConfig(
  owner: string,
  name: string,
  ref: string,
  token?: string,
  docsPath = "",
): Promise<boolean> {
  const dir = docsPath ? `${docsPath}/` : "";
  for (const file of ["docs.json", "mint.json"]) {
    const res = await fetch(`${API}/repos/${owner}/${name}/contents/${dir}${file}?ref=${ref}`, {
      headers: ghHeaders(token),
    });
    if (res.ok) return true;
  }
  return false;
}

// List a repo's branches (Git settings' Branch dropdown). Paginates to a sane cap —
// 300 branches is far more than any docs repo, and an unbounded loop on a pathological
// repo would stall the settings page. Empty on any error so the UI degrades to the
// stored branch rather than 500ing.
export async function listBranches(
  owner: string,
  name: string,
  token?: string,
): Promise<string[]> {
  const names: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `${API}/repos/${owner}/${name}/branches?per_page=100&page=${page}`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) break;
    const batch = (await res.json()) as Array<{ name: string }>;
    names.push(...batch.map((b) => b.name));
    if (batch.length < 100) break;
  }
  return names;
}

export type CommitInfo = { sha: string; message: string };

export async function fetchLatestCommit(
  owner: string,
  name: string,
  ref: string,
  token?: string,
): Promise<CommitInfo | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}/commits/${ref}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { sha: data.sha, message: data.commit?.message ?? "" };
}

// ---- Read path for automations (SPEC §10.2 — code-change triggers + context repos) ---
// An automation run may need to READ files from repos other than the docs repo — the
// source repo whose push triggered it, or a context repo it was told to consult. These
// power the agent's read_repo_file / list_repo_files tools. Same `token` seam (an
// installation token for the org's GitHub App); same never-throw contract.

// Read one file's text at a ref (branch or sha). Null on 404, a directory, or a file too
// large for the contents API (>1MB — GitHub omits `content` there, and a doc-writing
// agent has no use for a megabyte blob anyway).
export async function getRepoFile(
  owner: string,
  name: string,
  path: string,
  ref: string,
  token?: string,
): Promise<{ content: string } | null> {
  const clean = path.replace(/^\/+/, "");
  const res = await fetch(
    `${API}/repos/${owner}/${name}/contents/${clean.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(token) },
  );
  if (!res.ok) return null;
  const data = await res.json();
  // A directory returns an array; only files carry base64 content.
  if (Array.isArray(data) || data?.type !== "file" || typeof data.content !== "string") {
    return null;
  }
  try {
    return { content: Buffer.from(data.content, "base64").toString("utf8") };
  } catch {
    return null;
  }
}

// List a repo's file paths at a ref (branch or sha), capped so a huge monorepo can't
// blow the agent's context. Resolves ref → commit tree → recursive tree. Null on failure.
export async function listRepoTree(
  owner: string,
  name: string,
  ref: string,
  token?: string,
  opts: { limit?: number } = {},
): Promise<string[] | null> {
  const limit = opts.limit ?? 500;
  const commitRes = await fetch(`${API}/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`, {
    headers: ghHeaders(token),
  });
  if (!commitRes.ok) return null;
  const treeSha: string | undefined = (await commitRes.json()).commit?.tree?.sha;
  if (!treeSha) return null;
  const treeRes = await fetch(`${API}/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`, {
    headers: ghHeaders(token),
  });
  if (!treeRes.ok) return null;
  const tree = (await treeRes.json())?.tree as Array<{ path: string; type: string }> | undefined;
  if (!Array.isArray(tree)) return null;
  return tree
    .filter((e) => e.type === "blob" && typeof e.path === "string")
    .map((e) => e.path)
    .slice(0, limit);
}

// ---- Write path (the authoring backend, SPEC §9.2) ----------------------------------
// These power "edit docs on a branch → commit/PR". They use the same `token` seam as
// the read calls above, but the token must carry **write** scope: a GitHub App
// installation token for a repo the App can write, or a PAT with `contents` +
// `pull_requests`. Every call returns a structured result instead of throwing, so the
// editor / authoring MCP can surface a clean message rather than 500.

export type GitRef = { commitSha: string; treeSha: string };

// Resolve a branch's head commit sha + that commit's tree sha (the base for a new
// commit). Null if the branch is missing or the call fails.
export async function getRef(
  owner: string,
  name: string,
  branch: string,
  token?: string,
): Promise<GitRef | null> {
  const refRes = await fetch(`${API}/repos/${owner}/${name}/git/ref/heads/${refPath(branch)}`, {
    headers: ghHeaders(token),
  });
  if (!refRes.ok) return null;
  const commitSha: string | undefined = (await refRes.json()).object?.sha;
  if (!commitSha) return null;
  const commitRes = await fetch(`${API}/repos/${owner}/${name}/git/commits/${commitSha}`, {
    headers: ghHeaders(token),
  });
  if (!commitRes.ok) return null;
  const treeSha: string | undefined = (await commitRes.json()).tree?.sha;
  if (!treeSha) return null;
  return { commitSha, treeSha };
}

// Create a new branch ref at `fromSha`. A 422 "Reference already exists" is treated as
// success (alreadyExists: true) so checkout is idempotent.
export async function createBranch(
  owner: string,
  name: string,
  newBranch: string,
  fromSha: string,
  token?: string,
): Promise<{ ok: boolean; alreadyExists?: boolean; error?: string }> {
  const res = await fetch(`${API}/repos/${owner}/${name}/git/refs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
  if (res.ok) return { ok: true };
  const body = await res.text();
  if (res.status === 422 && /already exists/i.test(body)) return { ok: true, alreadyExists: true };
  return { ok: false, error: `createBranch ${res.status}: ${body.slice(0, 200)}` };
}

// A single file change in a commit. `content: null` deletes the path (tree entry with a
// null sha); otherwise the full new text. MDX/JSON are text, so content is inlined into
// the tree (no separate blob POST).
/**
 * One file in a commit. `content` is UTF-8 text, or null to DELETE the path.
 *
 * `base64` carries bytes instead — an uploaded video or image. The tree API's inline `content`
 * field is text-only, so binary has to become a blob first and be referenced by sha; passing raw
 * bytes through `content` would corrupt the file rather than fail, which is the worst outcome.
 */
export type FileChange = { path: string; content: string | null; base64?: string };

/** Upload raw bytes as a git blob and return its sha, for a tree entry that can't inline text. */
async function createBlob(
  owner: string,
  name: string,
  base64: string,
  token?: string,
): Promise<{ sha: string } | { error: string }> {
  const res = await fetch(`${API}/repos/${owner}/${name}/git/blobs`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ content: base64, encoding: "base64" }),
  });
  if (!res.ok) return { error: `createBlob: ${res.status} ${await res.text()}` };
  const json = (await res.json()) as { sha?: string };
  return json.sha ? { sha: json.sha } : { error: "createBlob: no sha in response" };
}

// Build one commit bearing N file changes on top of `baseCommitSha`/`baseTreeSha`.
// Returns the new commit sha. Does NOT move any ref — call updateRef next.
export async function commitFiles(
  owner: string,
  name: string,
  opts: {
    // Null for an INITIAL commit into a repo with no commits yet (adopting a
    // Papervine-hosted site into a fresh repo, SPEC §10.11): the tree is built from
    // scratch with no `base_tree`, and the commit has no parents. Every other caller
    // passes the base it read from `getRef`.
    baseCommitSha: string | null;
    baseTreeSha: string | null;
    files: FileChange[];
    message: string;
    token?: string;
  },
): Promise<{ commitSha: string } | { error: string }> {
  const { baseCommitSha, baseTreeSha, files, message, token } = opts;
  if (files.length === 0) return { error: "commitFiles: no changes" };
  // A deletion is meaningless with nothing to delete from, and GitHub rejects a null-sha
  // tree entry that matches no path — catch it here with a clearer message.
  if (baseTreeSha === null && files.some((f) => f.content === null)) {
    return { error: "commitFiles: cannot delete paths in an initial commit" };
  }
  // Binary files become blobs first: the tree API takes bytes only by sha. Sequential rather
  // than parallel — a batch of large uploads hitting the blob endpoint at once is what secondary
  // rate limits are for, and a publish is not a latency-critical path.
  const blobShas = new Map<string, string>();
  for (const f of files) {
    if (f.base64 === undefined) continue;
    const blob = await createBlob(owner, name, f.base64, token);
    if ("error" in blob) return { error: blob.error };
    blobShas.set(f.path, blob.sha);
  }

  const tree = files.map((f) => {
    if (f.content === null && f.base64 === undefined) {
      return { path: f.path, mode: "100644", type: "blob", sha: null };
    }
    const sha = blobShas.get(f.path);
    return sha
      ? { path: f.path, mode: "100644", type: "blob", sha }
      : { path: f.path, mode: "100644", type: "blob", content: f.content };
  });
  const treeRes = await fetch(`${API}/repos/${owner}/${name}/git/trees`, {
    method: "POST",
    headers: jsonHeaders(token),
    // Omit base_tree entirely for an initial commit — passing null makes GitHub 422.
    body: JSON.stringify(baseTreeSha === null ? { tree } : { base_tree: baseTreeSha, tree }),
  });
  if (!treeRes.ok) return { error: `createTree ${treeRes.status}: ${(await treeRes.text()).slice(0, 200)}` };
  const newTreeSha = (await treeRes.json()).sha;
  const commitRes = await fetch(`${API}/repos/${owner}/${name}/git/commits`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({
      message,
      tree: newTreeSha,
      parents: baseCommitSha === null ? [] : [baseCommitSha],
    }),
  });
  if (!commitRes.ok)
    return { error: `createCommit ${commitRes.status}: ${(await commitRes.text()).slice(0, 200)}` };
  return { commitSha: (await commitRes.json()).sha };
}

// Move a branch ref to `commitSha`. `force: false` (default) makes GitHub reject a
// non-fast-forward — our real concurrency guard against clobbering a moved branch.
export async function updateRef(
  owner: string,
  name: string,
  branch: string,
  commitSha: string,
  token?: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API}/repos/${owner}/${name}/git/refs/heads/${refPath(branch)}`, {
    method: "PATCH",
    headers: jsonHeaders(token),
    body: JSON.stringify({ sha: commitSha, force: opts.force ?? false }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: `updateRef ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

// Open a PR head→base. A 422 "already exists" returns the existing open PR instead of
// erroring (re-publishing the same branch is idempotent).
export async function openPullRequest(
  owner: string,
  name: string,
  opts: { head: string; base: string; title: string; body?: string; token?: string },
): Promise<{ number: number; url: string } | { error: string }> {
  const res = await fetch(`${API}/repos/${owner}/${name}/pulls`, {
    method: "POST",
    headers: jsonHeaders(opts.token),
    body: JSON.stringify({ title: opts.title, head: opts.head, base: opts.base, body: opts.body ?? "" }),
  });
  if (res.ok) {
    const pr = await res.json();
    return { number: pr.number, url: pr.html_url };
  }
  const text = await res.text();
  if (res.status === 422 && /already exists/i.test(text)) {
    const listRes = await fetch(
      `${API}/repos/${owner}/${name}/pulls?head=${encodeURIComponent(`${owner}:${opts.head}`)}&base=${encodeURIComponent(opts.base)}&state=open`,
      { headers: ghHeaders(opts.token) },
    );
    if (listRes.ok) {
      const list = (await listRes.json()) as Array<{ number: number; html_url: string }>;
      if (list[0]) return { number: list[0].number, url: list[0].html_url };
    }
  }
  return { error: `openPullRequest ${res.status}: ${text.slice(0, 200)}` };
}
