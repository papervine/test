// Pure helpers for Settings → Danger zone's "Transfer this site" (SPEC §10.5). Same split
// as danger-zone.ts: the decisions are sync + DB-free so the client form and the server
// action share them and they're unit-tested in isolation (tests/unit/transfer-site.test.ts).

// Who may move a site between organizations: owner or admin — the same bar as deleting a
// site, and it applies on BOTH ends (you must be able to manage sites in the source org
// *and* in the destination, or a plain member could smuggle a site into an org they can't
// administer).
export function canManageSites(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

// An org membership the picker considers as a destination.
export type TransferDestination = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
};

// What the picker renders for one org.
export type TransferOption = { slug: string; name: string; eligible: boolean };

// Every org of the actor's OTHER than the site's current one, flagged eligible when
// they're owner/admin there. Ineligible orgs are kept (shown disabled with the reason)
// rather than filtered out — hiding them read as "you aren't a member of any other
// organizations" to a user who knew they were, which is worse than a disabled row that
// says why. Roles come precomputed (the async membership lookup happens in the caller)
// so this stays pure.
export function destinationOptions(
  orgs: TransferDestination[],
  currentOrgId: string,
): TransferOption[] {
  return orgs
    .filter((o) => o.id !== currentOrgId)
    .map((o) => ({ slug: o.slug, name: o.name, eligible: canManageSites(o.role) }));
}

// Whether a site's GitHub App link survives the transfer. Installation rows are owned by
// the org that installed the App (githubInstallation.organizationId), so a transferred
// site may only keep its `githubInstallationId` if the destination org holds the SAME
// installation — otherwise the site would keep minting sync tokens from an installation
// the new org doesn't control (and the old org could revoke it out from under them).
// A site with no App link (public repo, or PAT — repoTokenEnc is site-scoped and travels
// with the row) always carries.
export function installationCarries(
  siteInstallationId: number | null,
  destInstallationIds: number[],
): boolean {
  if (siteInstallationId == null) return true;
  return destInstallationIds.includes(siteInstallationId);
}
