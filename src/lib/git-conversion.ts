/**
 * Taking a Papervine-hosted site onto Git (SPEC §10.11) — the pure core of the conversion.
 *
 * The shape of the operation: the site's current content is **committed into an empty repo**,
 * then `source_kind` flips to 'git' and the normal sync pulls it back. Nothing is lost, and
 * git history is the record.
 *
 * **Only an empty repo is accepted**, and that constraint is doing real work: it's what makes
 * the whole thing unambiguous. Merging into a repo that already has docs means reconciling two
 * `docs.json` navigations, and every resolution either drops the repo's sidebar or leaves our
 * pages as invisible orphans. Refusing up front is honest; "connect a second site to that
 * repo" is the answer for that case.
 */

/**
 * Files GitHub itself adds when you create a repo, which therefore don't make it non-empty.
 * Matched case-insensitively and extension-loosely, since GitHub's templates vary
 * (`README`, `README.md`, `LICENSE`, `LICENSE.txt`, …).
 */
const INIT_FILE_STEMS = new Set(["readme", "license", "licence", "notice", ".gitignore", "gitignore"]);

/** Config filenames that mean "this is already a docs site" — never overwrite one. */
const DOCS_CONFIG_FILES = new Set(["docs.json", "mint.json"]);

function isInitFile(path: string): boolean {
  // Top level only: a README inside a docs folder is content someone wrote.
  if (path.includes("/")) return false;
  const lower = path.toLowerCase();
  const stem = lower.startsWith(".") ? lower : (lower.split(".")[0] ?? lower);
  return INIT_FILE_STEMS.has(stem);
}

export type RepoEmptiness = { empty: true } | { empty: false; reason: string };

/**
 * Is this repo empty enough to adopt? `paths` is the repo tree at the target branch —
 * `null` means the branch has no commits at all, which is the emptiest case there is.
 *
 * Returns a reason phrased for the person reading it, not a code, because it's shown
 * verbatim in the UI and "why can't I pick this repo" is the whole question.
 */
export function repoEmptiness(paths: readonly string[] | null): RepoEmptiness {
  if (paths === null || paths.length === 0) return { empty: true };

  const config = paths.find((p) => DOCS_CONFIG_FILES.has(p.split("/").pop()?.toLowerCase() ?? ""));
  if (config) {
    return {
      empty: false,
      reason: `That repo already has a ${config.split("/").pop()} — it's already a docs site. Connect it as a separate site instead.`,
    };
  }

  const content = paths.filter((p) => !isInitFile(p));
  if (content.length > 0) {
    const sample = content.slice(0, 3).join(", ");
    return {
      empty: false,
      reason:
        `That repo isn't empty (it contains ${sample}${content.length > 3 ? `, and ${content.length - 3} more` : ""}). ` +
        "Create a new empty repository so your site's content becomes its first commit.",
    };
  }

  return { empty: true };
}

export type ConversionFile = { storageKey: string; repoPath: string };

/**
 * Map the site's storage objects to the repo paths they'll be committed at.
 *
 * Storage keys are `sites/{id}/{docs-relative path}`; the repo path re-adds `docsPath` when
 * the site is destined for a subdirectory. Our own sidecars (`.manifest.json`,
 * `.dimensions.json`) are sync bookkeeping, not content, and must never be committed — a
 * hosted site has none, but a git-backed one would, and this runs on whatever storage holds.
 */
export function planConversion(
  siteId: string,
  storageKeys: readonly string[],
  docsPath = "",
): ConversionFile[] {
  const prefix = `sites/${siteId}/`;
  const files: ConversionFile[] = [];
  for (const key of storageKeys) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (!rel || rel.endsWith("/")) continue;
    // Sidecars live at the prefix root and start with a dot.
    if (rel.startsWith(".")) continue;
    files.push({ storageKey: key, repoPath: docsPath ? `${docsPath}/${rel}` : rel });
  }
  // Deterministic order so the initial commit's tree is reproducible and diffable.
  return files.sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}
