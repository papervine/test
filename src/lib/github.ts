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
