// Read-only repository tools for automation runs (SPEC §10.2). A code_change or
// context-repo automation lets the agent READ files from repos other than the docs repo
// — the source whose push triggered it, plus any context repositories. These are the
// tools that back that: they wrap the plain-Node github.ts read functions with an
// installation token, scoped to an allowlist so the agent can't wander into arbitrary
// repos. Read-only by construction — the only write path stays the authoring backend.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getRepoFile, listRepoTree, parseRepoInput } from "@/lib/github";

export type RepoReadOptions = {
  // A GitHub App installation access token (the org's grant).
  token: string;
  // "owner/name" repos the agent may read this run.
  allowed: string[];
  // The ref to read a given repo at — the trigger repo reads at the push sha, context
  // repos at their default branch (undefined = repo default).
  refFor?: (repo: string) => string | undefined;
};

export function repoReadTools(opts: RepoReadOptions): ToolSet {
  const allowed = new Map(opts.allowed.map((r) => [r.toLowerCase(), r]));

  // Resolve a caller-supplied repo string to { owner, name, ref } iff it's allowed.
  function resolve(repo: string): { owner: string; name: string; ref?: string } | null {
    const canonical = allowed.get(repo.trim().toLowerCase());
    if (!canonical) return null;
    const parsed = parseRepoInput(canonical);
    if (!parsed) return null;
    return { owner: parsed.owner, name: parsed.name, ref: opts.refFor?.(canonical) };
  }

  const denied = (repo: string) =>
    `Repository "${repo}" is not available to this automation. Readable repositories: ${opts.allowed.join(", ") || "(none)"}.`;

  return {
    list_repo_files: tool({
      description:
        "List file paths in a context/source repository (read-only). Use before " +
        "read_repo_file to discover what exists. Only repositories configured for this " +
        "automation are available.",
      inputSchema: z.object({
        repo: z.string().describe('The repository, "owner/name".'),
        path: z
          .string()
          .optional()
          .describe("Optional path prefix to filter to (e.g. 'src/api')."),
      }),
      execute: async ({ repo, path }) => {
        const r = resolve(repo);
        if (!r) return { error: denied(repo) };
        const paths = await listRepoTree(r.owner, r.name, r.ref ?? "HEAD", opts.token);
        if (paths === null) return { error: `Couldn't list "${repo}" (not found or no access).` };
        const prefix = path?.replace(/^\/+/, "");
        const filtered = prefix ? paths.filter((p) => p.startsWith(prefix)) : paths;
        return { repo, count: filtered.length, files: filtered };
      },
    }),
    read_repo_file: tool({
      description:
        "Read one file's text from a context/source repository (read-only). Only " +
        "repositories configured for this automation are available.",
      inputSchema: z.object({
        repo: z.string().describe('The repository, "owner/name".'),
        path: z.string().describe("Repo-relative file path."),
      }),
      execute: async ({ repo, path }) => {
        const r = resolve(repo);
        if (!r) return { error: denied(repo) };
        const file = await getRepoFile(r.owner, r.name, path, r.ref ?? "HEAD", opts.token);
        if (!file) return { error: `Couldn't read "${path}" in "${repo}" (missing, a directory, or too large).` };
        return { repo, path, content: file.content };
      },
    }),
  };
}
