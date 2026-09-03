import { describe, it, expect, vi, beforeEach } from "vitest";

// The Notion tool set (SPEC §10.2 connector tool layer). Nango is mocked: what's under
// test is OUR half — the request shapes Notion demands, and the block-tree → Markdown
// flattening, which is the whole reason this connector is more than a fetch wrapper.

const proxy = vi.fn();
vi.mock("../../src/lib/integrations/nango", () => ({ proxy: (...a: unknown[]) => proxy(...a) }));

async function tools() {
  const { notionTools } = await import("../../src/lib/integrations/providers/notion");
  return notionTools("org_1");
}

type Exec = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const run = (t: unknown, args: Record<string, unknown>) =>
  (((t as { execute: Exec }).execute) as Exec)(args);

// Notion splits text on every formatting change, so one sentence arrives as several runs.
const rich = (...parts: string[]) => parts.map((plain_text) => ({ plain_text }));

beforeEach(() => {
  proxy.mockReset();
});

describe("search_notion", () => {
  it("POSTs a page-filtered search carrying the required version header", async () => {
    proxy.mockResolvedValue({ data: { results: [] } });
    const t = await tools();
    await run(t.search_notion, { query: "onboarding" });

    const call = proxy.mock.calls[0][0];
    expect(call).toMatchObject({ organizationId: "org_1", provider: "notion", method: "POST" });
    expect(call.endpoint).toBe("/v1/search");
    // Notion refuses any request without a version.
    expect(call.headers).toEqual({ "Notion-Version": "2022-06-28" });
    // Databases come back from this endpoint too and can't be read by read_notion_page,
    // so returning them would hand the model dead ids.
    expect(call.data).toMatchObject({
      query: "onboarding",
      filter: { property: "object", value: "page" },
    });
  });

  it("pulls the title out of whichever property has type 'title'", async () => {
    // The KEY varies by database — "Name", "Task", anything — so it can't be looked up
    // by name, which is the trap this covers.
    proxy.mockResolvedValue({
      data: {
        results: [
          {
            id: "p1",
            url: "https://notion.so/p1",
            properties: {
              Effort: { type: "number" },
              "Some Custom Key": { type: "title", title: rich("Onboard", "ing Guide") },
            },
          },
        ],
      },
    });
    const t = await tools();
    expect(await run(t.search_notion, { query: "x" })).toEqual({
      pages: [{ id: "p1", title: "Onboarding Guide", url: "https://notion.so/p1" }],
    });
  });

  it("falls back to Untitled rather than an empty name", async () => {
    proxy.mockResolvedValue({ data: { results: [{ id: "p2", properties: {} }] } });
    const t = await tools();
    const res = await run(t.search_notion, { query: "x" });
    expect((res.pages as { title: string }[])[0].title).toBe("Untitled");
  });

  it("explains an empty result — sharing, not absence, is the usual cause", async () => {
    proxy.mockResolvedValue({ data: { results: [] } });
    const t = await tools();
    const res = await run(t.search_notion, { query: "nope" });
    // Without this the agent reports "no such page" about pages that exist but were
    // never shared with the integration.
    expect(res.note).toMatch(/explicitly shared/i);
  });

  it("surfaces an error as a tool RESULT — a run must never die on a connector", async () => {
    proxy.mockResolvedValue({ error: "unauthorized" });
    const t = await tools();
    expect(await run(t.search_notion, { query: "x" })).toEqual({ error: "unauthorized" });
  });
});

describe("read_notion_page", () => {
  const meta = {
    data: {
      id: "p1",
      url: "https://notion.so/p1",
      properties: { Name: { type: "title", title: rich("Spec") } },
    },
  };

  it("reads metadata and blocks, and flattens the tree to Markdown", async () => {
    proxy.mockResolvedValueOnce(meta).mockResolvedValueOnce({
      data: {
        results: [
          { id: "b1", type: "heading_1", heading_1: { rich_text: rich("Overview") } },
          { id: "b2", type: "paragraph", paragraph: { rich_text: rich("Hello ", "world") } },
          { id: "b3", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich("one") } },
          { id: "b4", type: "to_do", to_do: { rich_text: rich("done"), checked: true } },
          { id: "b5", type: "to_do", to_do: { rich_text: rich("open"), checked: false } },
          { id: "b6", type: "code", code: { rich_text: rich("npm test"), language: "bash" } },
          { id: "b7", type: "quote", quote: { rich_text: rich("cited") } },
          { id: "b8", type: "divider", divider: {} },
        ],
      },
    });
    const t = await tools();
    const res = await run(t.read_notion_page, { pageId: "p1" });

    expect(res.title).toBe("Spec");
    expect(res.url).toBe("https://notion.so/p1");
    expect(res.content).toBe(
      [
        "# Overview",
        "Hello world",
        "- one",
        "- [x] done",
        "- [ ] open",
        "```bash\nnpm test\n```",
        "> cited",
        "---",
      ].join("\n"),
    );
  });

  it("drops blocks with nothing to say instead of emitting blank lines", async () => {
    proxy.mockResolvedValueOnce(meta).mockResolvedValueOnce({
      data: {
        results: [
          { id: "b1", type: "image", image: {} },
          { id: "b2", type: "paragraph", paragraph: { rich_text: [] } },
          { id: "b3", type: "paragraph", paragraph: { rich_text: rich("kept") } },
        ],
      },
    });
    const t = await tools();
    expect((await run(t.read_notion_page, { pageId: "p1" })).content).toBe("kept");
  });

  it("keeps the URL of link-shaped blocks, where the URL is the content", async () => {
    proxy.mockResolvedValueOnce(meta).mockResolvedValueOnce({
      data: { results: [{ id: "b1", type: "bookmark", bookmark: { url: "https://example.com" } }] },
    });
    const t = await tools();
    expect((await run(t.read_notion_page, { pageId: "p1" })).content).toBe(
      "[link] https://example.com",
    );
  });

  it("says when the page has more blocks than it read", async () => {
    proxy.mockResolvedValueOnce(meta).mockResolvedValueOnce({
      data: { results: [{ id: "b1", type: "paragraph", paragraph: { rich_text: rich("a") } }], has_more: true },
    });
    const t = await tools();
    // Silence here would let the model claim it read a page it only partly saw.
    expect((await run(t.read_notion_page, { pageId: "p1" })).note).toMatch(/more blocks/i);
  });

  it("url-encodes the page id and surfaces a metadata failure without reading blocks", async () => {
    proxy.mockResolvedValueOnce({ error: "not found" });
    const t = await tools();
    expect(await run(t.read_notion_page, { pageId: "a/b" })).toEqual({ error: "not found" });
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0].endpoint).toBe("/v1/pages/a%2Fb");
  });
});
