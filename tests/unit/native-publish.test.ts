import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level vars, so shared state the factories close over must be
// created with vi.hoisted too.
const { storage, store, log, calls, dbState } = vi.hoisted(() => ({
  storage: { putObject: vi.fn(), deleteKeys: vi.fn(), listKeys: vi.fn() },
  store: {
    session: null as null | { id: string },
    drafts: [] as Array<{ path: string; content: string; deleted: boolean }>,
    closed: [] as Array<[string, string]>,
  },
  log: { openDeployment: vi.fn(), resolveDeployment: vi.fn(), markSiteLive: vi.fn() },
  // One ordered trace of every storage mutation, so "pages before config before deletes"
  // is asserted as an ORDER, not just as a set of calls.
  calls: [] as string[],
  dbState: { building: [] as Array<{ createdAt: Date }> },
}));

vi.mock("../../src/lib/storage", () => storage);
vi.mock("../../src/lib/draft-store", () => ({
  findOpenSession: vi.fn(async () => store.session),
  listDraftFiles: vi.fn(async () => store.drafts),
  closeSession: vi.fn(async (id: string, status: string) => {
    store.closed.push([id, status]);
    calls.push(`close:${status}`);
  }),
}));
vi.mock("../../src/lib/deployment-log", () => log);
vi.mock("../../src/lib/s3-source", () => ({ revalidateSite: vi.fn() }));
// The in-flight guard reads the newest `building` deployment row; stub the query chain.
vi.mock("../../src/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => dbState.building }) }),
      }),
    }),
  },
}));

import { publishNative } from "../../src/lib/native-publish";

type Site = Parameters<typeof publishNative>[0];
const site = {
  id: "s1",
  slug: "acme",
  customDomain: null,
  sourceKind: "native",
  repoOwner: null,
  repoName: null,
  branch: "main",
  docsPath: "",
} as unknown as Site;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  store.session = { id: "sess1" };
  store.closed = [];
  store.drafts = [{ path: "index.mdx", content: "# Hi", deleted: false }];
  dbState.building = [];
  storage.listKeys.mockResolvedValue([]);
  storage.putObject.mockImplementation(async (key: string) => {
    calls.push(`put:${key}`);
  });
  storage.deleteKeys.mockImplementation(async (keys: string[]) => {
    calls.push(`delete:${keys.join(",")}`);
  });
  log.openDeployment.mockResolvedValue("dep1");
});

describe("publishNative", () => {
  it("writes the drafts into the site's storage prefix and reports the file count", async () => {
    const res = await publishNative(site, "main");
    expect(res).toEqual({ ok: true, mode: "native", files: 1, deploymentId: "dep1" });
    expect(calls).toContain("put:sites/s1/index.mdx");
  });

  // THE ordering invariant: docs.json is the navigation, so publishing it before the pages
  // it references would leave readers with sidebar entries that 404 for the width of the
  // write window. Deletes go last, after the new config has stopped referencing them.
  it("writes pages, then docs.json, then deletes", async () => {
    store.drafts = [
      { path: "docs.json", content: "{}", deleted: false },
      { path: "index.mdx", content: "# Hi", deleted: false },
      { path: "gone.mdx", content: "", deleted: true },
    ];
    storage.listKeys.mockResolvedValue(["sites/s1/gone.mdx"]);

    await publishNative(site, "main");

    const order = calls.filter((c) => c.startsWith("put:") || c.startsWith("delete:"));
    expect(order).toEqual([
      "put:sites/s1/index.mdx",
      "put:sites/s1/docs.json",
      "delete:sites/s1/gone.mdx",
    ]);
  });

  // Without this the publish is invisible: updatedAt is the ENTIRE content-cache version
  // key for a hosted site (its commit sha is null forever), so readers keep the old key
  // and keep being served the pre-publish copy.
  it("promotes the site to live so readers see the new content", async () => {
    await publishNative(site, "main");
    expect(log.markSiteLive).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ fireAutomations: true, fallbackRef: "dep1" }),
    );
  });

  it("records a successful deployment with the file counts", async () => {
    storage.listKeys.mockResolvedValue(["sites/s1/index.mdx"]);
    store.drafts = [
      { path: "index.mdx", content: "# Edited", deleted: false },
      { path: "new.mdx", content: "# New", deleted: false },
    ];
    await publishNative(site, "main");
    expect(log.openDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: "s1", trigger: "publish" }),
    );
    expect(log.resolveDeployment).toHaveBeenCalledWith(
      "dep1",
      expect.objectContaining({ ok: true, filesAdded: 1, filesEdited: 1 }),
    );
  });

  it("closes the session once published", async () => {
    await publishNative(site, "main");
    expect(store.closed).toEqual([["sess1", "published"]]);
  });

  it("uses the given message as the deployment's title", async () => {
    await publishNative(site, "main", { message: "  Ship the guide  " });
    expect(log.openDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ commitMessage: "Ship the guide" }),
    );
  });
});

// An automation that publishes must not re-trigger itself. The fan-out dedupes on a ref,
// and a hosted publish has no commit sha to dedupe on, so without this suppression the
// automation would re-fire until the daily run cap stopped it.
describe("publishNative — automation origin", () => {
  it("suppresses the content_update fan-out when the automation itself is publishing", async () => {
    await publishNative(site, "main", { origin: "automation" });
    expect(log.markSiteLive).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ fireAutomations: false }),
    );
  });

  it("fans out for an ordinary editor publish", async () => {
    await publishNative(site, "main", { origin: "editor" });
    expect(log.markSiteLive).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ fireAutomations: true }),
    );
  });
});

describe("publishNative — failure is retry-safe", () => {
  // The guarantee is at-least-once, not atomic: on failure the drafts must SURVIVE, or a
  // half-written publish would lose the source of truth with no way to retry.
  it("leaves the session open and records a failed deployment when a write throws", async () => {
    storage.putObject.mockRejectedValue(new Error("S3 exploded"));

    const res = await publishNative(site, "main");

    expect(res).toMatchObject({ ok: false });
    expect(store.closed).toEqual([]);
    expect(log.markSiteLive).not.toHaveBeenCalled();
    expect(log.resolveDeployment).toHaveBeenCalledWith(
      "dep1",
      expect.objectContaining({ ok: false, error: expect.stringContaining("S3 exploded") }),
    );
  });
});

describe("publishNative — guards", () => {
  it("errors when there is no open session", async () => {
    store.session = null;
    const res = await publishNative(site, "main");
    expect(res).toEqual({ ok: false, error: "No open edit session for this branch." });
    expect(log.openDeployment).not.toHaveBeenCalled();
  });

  it("is a no-op when there are no drafts", async () => {
    store.drafts = [];
    const res = await publishNative(site, "main");
    expect(res).toEqual({ ok: false, error: "No changes to publish." });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  // Two publishes interleaving over one storage prefix can leave a reader a torn tree, so
  // a publish already in flight blocks a second one — the same guard Re-sync uses.
  it("refuses while another publish is in flight", async () => {
    dbState.building = [{ createdAt: new Date() }];
    const res = await publishNative(site, "main");
    expect(res).toMatchObject({ ok: false, conflict: true });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  // A `building` row left behind by a killed run must not block publishing forever.
  it("ignores a stale building row", async () => {
    dbState.building = [{ createdAt: new Date(Date.now() - 60 * 60_000) }];
    const res = await publishNative(site, "main");
    expect(res).toMatchObject({ ok: true });
  });
});
