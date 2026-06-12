import { normalizeDocsPath } from "./github";

// The git-source config the Git settings page reads and writes. Mirrors the `site`
// columns that point at a repo (SPEC §3): which GitHub App installation backs it
// (null = a PAT/public connection), the owner/repo/branch, and the docs.json
// subdirectory. Pure module (no "use server"/server-only) so the client form, the
// save action, and the unit tests all share one shape + one dirty-check.
export type GitConfig = {
  installationId: number | null;
  owner: string;
  name: string;
  branch: string;
  docsPath: string;
};

// Has the draft diverged from what's saved? Drives the Save button's enabled state.
// docsPath is compared normalized so cosmetic differences ("docs/" vs "docs", trailing
// "." segments) don't read as a change — normalizeDocsPath is what the save persists.
export function gitSettingsDirty(saved: GitConfig, draft: GitConfig): boolean {
  return (
    saved.installationId !== draft.installationId ||
    saved.owner !== draft.owner ||
    saved.name !== draft.name ||
    saved.branch !== draft.branch ||
    normalizeDocsPath(saved.docsPath) !== normalizeDocsPath(draft.docsPath)
  );
}
