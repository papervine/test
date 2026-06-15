import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page, ContentSource } from "@papervine/renderer/lib/content";

// React's `cache()` needs a render context; under Node it's an identity memoizer for us.
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));

// Fake synced (S3) base source the overlay falls through to.
const base: ContentSource = {
  loadConfig: vi.fn(async () => ({ name: "Base" }) as never),
  loadPage: vi.fn(async (slug: string): Promise<Page | null> => {
    if (slug === "kept") return { slug: "kept", frontmatter: {}, body: "base kept" };
    if (slug === "" ) return { slug: "", frontmatter: {}, body: "base index" };
    return null;
  }),
  listPageSlugs: vi.fn(async () => ["", "kept", "gone"]),
};
vi.mock("../../src/lib/s3-source", () => ({ s3Source: () => base }));

// Draft store, controlled per-test.
const store = {
  session: { id: "sess1" } as { id: string } | null,
  drafts: new Map<string, { content: string; deleted: boolean }>(),
};
vi.mock("../../src/lib/draft-store", () => ({
  findOpenSession: vi.fn(async () => store.session),
  getDraftFile: vi.fn(async (_s: string, path: string) => {
    const d = store.drafts.get(path);
    return d ? { sessionId: "sess1", path, ...d } : null;
  }),
  listDraftFiles: vi.fn(async () =>
    [...store.drafts.entries()].map(([path, d]) => ({ sessionId: "sess1", path, ...d })),
  ),
}));

import { draftSource } from "../../src/lib/draft-source";

beforeEach(() => {
  store.session = { id: "sess1" };
  store.drafts = new Map();
});

describe("draftSource overlay", () => {
  it("returns the draft body for an edited page", async () => {
    store.drafts.set("kept.mdx", { content: "DRAFT edit", deleted: false });
    const page = await draftSource("site1", "br").loadPage("kept");
    expect(page?.body).toBe("DRAFT edit");
  });

  it("falls through to the base source for an unedited page", async () => {
    const page = await draftSource("site1", "br").loadPage("kept");
    expect(page?.body).toBe("base kept");
  });

  it("hides a tombstoned (deleted) page", async () => {
    store.drafts.set("gone.mdx", { content: "", deleted: true });
    const src = draftSource("site1", "br");
    expect(await src.loadPage("gone")).toBeNull();
    expect(await src.listPageSlugs()).not.toContain("gone");
  });

  it("adds a brand-new draft page to the slug list", async () => {
    store.drafts.set("new-page.mdx", { content: "# New", deleted: false });
    const slugs = await draftSource("site1", "br").listPageSlugs();
    expect(slugs).toContain("new-page");
    expect(slugs).toContain("kept"); // base slugs preserved
  });

  it("prefers a draft docs.json over the base config", async () => {
    store.drafts.set("docs.json", { content: JSON.stringify({ name: "Drafted" }), deleted: false });
    const config = await draftSource("site1", "br").loadConfig();
    expect(config.name).toBe("Drafted");
  });

  it("behaves exactly like the base source when there is no open session", async () => {
    store.session = null;
    const src = draftSource("site1", "br");
    expect((await src.loadPage("kept"))?.body).toBe("base kept");
    expect(await src.listPageSlugs()).toEqual(["", "kept", "gone"]);
    expect((await src.loadConfig()).name).toBe("Base");
  });
});
