// Minimal GitHub REST client for the connect-a-repo flow. Public repos only for
// now (unauthenticated — 60 req/hr); the GitHub App (private repos, install
// tokens, push webhooks) is the follow-up. A GITHUB_TOKEN, if present, raises the
// rate limit and is the seam the App will plug into later.
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

function ghHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "docbot",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export type RepoMeta = { fullName: string; defaultBranch: string };

export async function fetchRepo(owner: string, name: string): Promise<RepoMeta | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return { fullName: data.full_name, defaultBranch: data.default_branch };
}

// True if the repo has a Docbot/docs.json config at its root on the given ref.
export async function hasDocsConfig(owner: string, name: string, ref: string): Promise<boolean> {
  for (const file of ["docs.json", "mint.json"]) {
    const res = await fetch(`${API}/repos/${owner}/${name}/contents/${file}?ref=${ref}`, {
      headers: ghHeaders(),
    });
    if (res.ok) return true;
  }
  return false;
}

export type CommitInfo = { sha: string; message: string };

export async function fetchLatestCommit(
  owner: string,
  name: string,
  ref: string,
): Promise<CommitInfo | null> {
  const res = await fetch(`${API}/repos/${owner}/${name}/commits/${ref}`, { headers: ghHeaders() });
  if (!res.ok) return null;
  const data = await res.json();
  return { sha: data.sha, message: data.commit?.message ?? "" };
}
