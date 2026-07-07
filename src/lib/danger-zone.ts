// Pure helpers for the Settings → Danger zone surface (SPEC §10.5). Kept out of the
// "use server" actions file because a "use server" module may only export async actions
// — these sync helpers are shared by the client form and unit-tested in isolation
// (tests/unit/danger-zone.test.ts).

// What's being destroyed. A "site" is one docs deployment (hosted docs platforms' "deployment"); an
// "organization" is the whole workspace — every site, member, and row under it.
export type DangerScope = "site" | "organization";

// A deletion is gated twice: a non-empty reason (the exit-survey we persist), and a
// type-to-confirm of the resource's exact slug (the GitHub/Vercel guard against a
// fat-fingered, irreversible click). Both must pass before the action runs.
export function isReasonValid(reason: string): boolean {
  return reason.trim().length > 0;
}

// The typed confirmation must match the resource's slug exactly (after trimming) — the slug,
// not the display name, because the slug is what the user sees in the URL/subdomain and the
// sidebar (a "sdfdsf" site whose slug deduped to "sdfdsf-3" would otherwise never confirm).
// Case-sensitive, like GitHub's "type the repository name".
export function confirmationMatches(typed: string, slug: string): boolean {
  return typed.trim() === slug.trim();
}

// Both gates at once — the button is armed only when this is true.
export function canDelete(reason: string, typed: string, slug: string): boolean {
  return isReasonValid(reason) && confirmationMatches(typed, slug);
}

// The out-of-band resources a site owns *beyond* the Postgres FK cascade — what the delete
// actions must clean up by hand. Two kinds, neither of which cascades with the row:
//   • its object-storage prefix (sites/{id}/ — always present), and
//   • its attached Vercel project-domain (only if it set a custom domain), which holds a
//     slot against a finite per-project cap (SPEC §2) and, once the row is gone, can't be
//     found again to detach. removeCustomDomain frees it on un-set; deletion must too.
// Pure so both delete paths (one site, or every site under an org) can be unit-tested
// without a DB or the network — same split as parseDomainStatus vs. its fetch.
export type SiteResources = { id: string; customDomain: string | null };
export type ResourceCleanup = { storagePrefixes: string[]; domainsToDetach: string[] };

export function planResourceCleanup(sites: SiteResources[]): ResourceCleanup {
  return {
    storagePrefixes: sites.map((s) => `sites/${s.id}/`),
    domainsToDetach: sites
      .map((s) => s.customDomain)
      .filter((d): d is string => Boolean(d)),
  };
}
