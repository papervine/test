import { describe, it, expect, vi, beforeEach } from "vitest";

// `runSync`'s revision bookkeeping (SPEC §10.11). Narrow on purpose: the sync itself is covered
// by the e2e connect flow and by sync-plan's unit tests — what's pinned here is the pair of
// writes that make a deploy rollback-able, because getting one without the other is invisible.
//
// THE bug this exists to prevent: `markSiteLive` was given the revision (so the site served the
// right content and everything looked correct) while `resolveDeployment` was not — leaving every
// deployment row with a null `revision_id`. Nothing errored, nothing rendered wrong, and the
// Roll back button simply never appeared on any real deploy, because `canRollBack` reads the
// deployment row rather than the site.

const { sync, log, gh, revisions } = vi.hoisted(() => ({
  sync: { syncSite: vi.fn() },
  log: { openDeployment: vi.fn(), resolveDeployment: vi.fn(), markSiteLive: vi.fn() },
  gh: { fetchLatestCommit: vi.fn() },
  revisions: { pruneSiteRevisions: vi.fn() },
}));

vi.mock("../../src/lib/sync", () => sync);
vi.mock("../../src/lib/deployment-log", () => log);
vi.mock("../../src/lib/github", () => gh);
vi.mock("../../src/lib/github-token", () => ({ repoTokenForSite: vi.fn(async () => "tok") }));
vi.mock("../../src/lib/s3-source", () => ({ revalidateSite: vi.fn() }));
vi.mock("../../src/lib/revision-store", () => revisions);

import { runSync } from "../../src/lib/sync-runner";

type Site = Parameters<typeof runSync>[0];
const site = {
  id: "s1",
  slug: "acme",
  customDomain: null,
  repoOwner: "acme",
  repoName: "docs",
  branch: "main",
  docsPath: "",
  liveRevisionId: null,
} as unknown as Site;

beforeEach(() => {
  vi.clearAllMocks();
  log.openDeployment.mockResolvedValue("dep1");
  gh.fetchLatestCommit.mockResolvedValue({ sha: "abc1234", message: "a commit" });
  sync.syncSite.mockResolvedValue({ files: 3, uploaded: 1 });
});

describe("runSync revision bookkeeping", () => {
  it("builds a revision named for the deployment, from whatever is live now", async () => {
    await runSync(site, { trigger: "manual" });
    expect(sync.syncSite).toHaveBeenCalledWith(
      // A site with no revision yet carries forward from the legacy flat prefix — that's how
      // it migrates without a backfill.
      expect.objectContaining({ revisionId: "dep1", fromPrefix: "sites/s1/" }),
    );
  });

  it("carries forward from the site's CURRENT revision once it has one", async () => {
    await runSync({ ...site, liveRevisionId: "rPrev" } as Site, { trigger: "manual" });
    expect(sync.syncSite).toHaveBeenCalledWith(
      expect.objectContaining({ fromPrefix: "revs/s1/rPrev/" }),
    );
  });

  it("points the site at the new revision", async () => {
    await runSync(site, { trigger: "manual" });
    expect(log.markSiteLive).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ revisionId: "dep1" }),
    );
  });

  it("ALSO records the revision on the deployment row — the half that was missing", async () => {
    await runSync(site, { trigger: "manual" });
    expect(log.resolveDeployment).toHaveBeenCalledWith(
      "dep1",
      expect.objectContaining({ ok: true, revisionId: "dep1" }),
    );
  });

  it("records NO revision on a failed sync", async () => {
    // A failed sync leaves a partial tree that was never pointed at. Advertising it would offer
    // a Roll back to content we deliberately refused to publish.
    sync.syncSite.mockRejectedValue(new Error("GitHub exploded"));
    await runSync(site, { trigger: "manual" });
    expect(log.resolveDeployment).toHaveBeenCalledWith(
      "dep1",
      expect.objectContaining({ ok: false, revisionId: null }),
    );
    expect(log.markSiteLive).not.toHaveBeenCalled();
  });
});
