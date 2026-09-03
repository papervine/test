import { describe, it, expect, vi, beforeEach } from "vitest";

// The Jira tool set (SPEC §10.2 connector tool layer). Transport is mocked; what's under
// test is OUR half — the two Jira Cloud specifics that fail loudly in production if wrong
// (the cloudId in the path, and the endpoint that replaced the removed one), plus the ADF
// flattening, which is the bulk of the work.

const proxy = vi.fn();
const connectionConfig = vi.fn();
vi.mock("../../src/lib/integrations/nango", () => ({
  proxy: (...a: unknown[]) => proxy(...a),
  connectionConfig: (...a: unknown[]) => connectionConfig(...a),
}));

async function tools() {
  const { jiraTools } = await import("../../src/lib/integrations/providers/jira");
  return jiraTools("org_1");
}

type Exec = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const run = (t: unknown, args: Record<string, unknown>) =>
  (((t as { execute: Exec }).execute) as Exec)(args);

const text = (t: string) => ({ type: "text", text: t });

beforeEach(() => {
  vi.resetModules();
  proxy.mockReset();
  connectionConfig.mockReset();
  connectionConfig.mockResolvedValue({ cloudId: "cloud-123" });
});

describe("search_jira_issues", () => {
  it("POSTs to /search/jql with named fields, under the cloudId path", async () => {
    proxy.mockResolvedValue({ data: { issues: [] } });
    const t = await tools();
    await run(t.search_jira_issues, { jql: "project = DOCS" });

    const call = proxy.mock.calls[0][0];
    expect(call.method).toBe("POST");
    // GET /rest/api/3/search returns 410 on Cloud since the 2025 sunset; /search/jql is
    // the replacement, and the cloudId has to be spliced into the path by us.
    expect(call.endpoint).toBe("/ex/jira/cloud-123/rest/api/3/search/jql");
    expect(call.data.jql).toBe("project = DOCS");
    // Unlike the old endpoint, this one returns NO fields unless they're named.
    expect(call.data.fields).toEqual(
      expect.arrayContaining(["summary", "status", "issuetype", "assignee"]),
    );
  });

  it("resolves the cloudId once and reuses it across calls", async () => {
    proxy.mockResolvedValue({ data: { issues: [] } });
    const t = await tools();
    await run(t.search_jira_issues, { jql: "a" });
    await run(t.search_jira_issues, { jql: "b" });
    // Two round trips per answer is the thing this avoids.
    expect(connectionConfig).toHaveBeenCalledTimes(1);
  });

  it("tells the operator what to do when the connection has no cloudId", async () => {
    connectionConfig.mockResolvedValue({});
    const t = await tools();
    const res = await run(t.search_jira_issues, { jql: "x" });
    expect(res.error).toMatch(/reconnect jira/i);
    // And it must not fire a request at a path with "undefined" in it.
    expect(proxy).not.toHaveBeenCalled();
  });

  it("summarizes issues and reports that more exist without inventing a total", async () => {
    proxy.mockResolvedValue({
      data: {
        issues: [
          {
            key: "DOCS-42",
            fields: {
              summary: "Auth docs are wrong",
              status: { name: "In Progress" },
              issuetype: { name: "Bug" },
              priority: { name: "High" },
              assignee: { displayName: "Ada" },
              updated: "2026-09-01T10:00:00.000+0000",
            },
          },
        ],
        nextPageToken: "opaque",
      },
    });
    const t = await tools();
    const res = await run(t.search_jira_issues, { jql: "x" });
    expect(res.issues).toEqual([
      {
        key: "DOCS-42",
        summary: "Auth docs are wrong",
        status: "In Progress",
        type: "Bug",
        priority: "High",
        assignee: "Ada",
        updated: "2026-09-01T10:00:00.000+0000",
      },
    ]);
    // Cursor pagination drops `total`, so "more exist" is all that can honestly be said.
    expect(res.note).toMatch(/more issues/i);
  });

  it("says Unassigned rather than dropping the field", async () => {
    proxy.mockResolvedValue({ data: { issues: [{ key: "D-1", fields: { assignee: null } }] } });
    const t = await tools();
    const res = await run(t.search_jira_issues, { jql: "x" });
    expect((res.issues as { assignee: string }[])[0].assignee).toBe("Unassigned");
  });

  it("surfaces an error as a tool RESULT — a run must never die on a connector", async () => {
    proxy.mockResolvedValue({ error: "401 unauthorized" });
    const t = await tools();
    expect(await run(t.search_jira_issues, { jql: "x" })).toEqual({ error: "401 unauthorized" });
  });
});

describe("read_jira_issue", () => {
  const issue = {
    data: {
      key: "DOCS-42",
      fields: {
        summary: "Auth docs are wrong",
        status: { name: "Open" },
        assignee: { displayName: "Ada" },
        description: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
            { type: "paragraph", content: [text("It "), text("breaks")] },
            {
              type: "bulletList",
              content: [
                { type: "listItem", content: [{ type: "paragraph", content: [text("one")] }] },
                { type: "listItem", content: [{ type: "paragraph", content: [text("two")] }] },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "bash" },
              content: [text("npm test")],
            },
          ],
        },
      },
    },
  };

  it("flattens ADF into readable Markdown", async () => {
    proxy.mockResolvedValueOnce(issue).mockResolvedValueOnce({ data: { comments: [] } });
    const t = await tools();
    const res = await run(t.read_jira_issue, { issueKey: "DOCS-42" });

    // A description is a node TREE, not a string — this is the whole reason the connector
    // is more than a fetch wrapper.
    expect(res.description).toBe(
      ["## Steps", "It breaks", "- one", "- two", "```bash\nnpm test\n```"].join("\n"),
    );
    expect(res).toMatchObject({ key: "DOCS-42", status: "Open", assignee: "Ada" });
  });

  it("renders mentions and links rather than leaking raw ids", async () => {
    proxy
      .mockResolvedValueOnce({
        data: {
          key: "D-1",
          fields: {
            description: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "mention", attrs: { id: "557058:abc", text: "Ada" } },
                    text(" see "),
                    { type: "inlineCard", attrs: { url: "https://example.com/x" } },
                  ],
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({ data: { comments: [] } });
    const t = await tools();
    const res = await run(t.read_jira_issue, { issueKey: "D-1" });
    expect(res.description).toBe("@Ada see https://example.com/x");
  });

  it("fetches comments by default and flattens them too", async () => {
    proxy.mockResolvedValueOnce(issue).mockResolvedValueOnce({
      data: {
        comments: [
          {
            author: { displayName: "Grace" },
            created: "2026-09-02T09:00:00.000+0000",
            body: { type: "doc", content: [{ type: "paragraph", content: [text("Fixed in 1.2")] }] },
          },
        ],
      },
    });
    const t = await tools();
    const res = await run(t.read_jira_issue, { issueKey: "DOCS-42" });
    expect(res.comments).toEqual([
      { author: "Grace", created: "2026-09-02T09:00:00.000+0000", body: "Fixed in 1.2" },
    ]);
    expect(proxy.mock.calls[1][0].endpoint).toBe("/ex/jira/cloud-123/rest/api/3/issue/DOCS-42/comment");
  });

  it("skips the comment call when asked to", async () => {
    proxy.mockResolvedValueOnce(issue);
    const t = await tools();
    const res = await run(t.read_jira_issue, { issueKey: "DOCS-42", includeComments: false });
    expect(res.comments).toBeUndefined();
    expect(proxy).toHaveBeenCalledTimes(1);
  });

  it("still returns the issue when only the comments fail", async () => {
    proxy.mockResolvedValueOnce(issue).mockResolvedValueOnce({ error: "comment perms" });
    const t = await tools();
    const res = await run(t.read_jira_issue, { issueKey: "DOCS-42" });
    // Losing a readable issue because its discussion was forbidden would be the wrong trade.
    expect(res.summary).toBe("Auth docs are wrong");
    expect(res.commentsError).toBe("comment perms");
  });

  it("url-encodes the key and surfaces a fetch failure without reading comments", async () => {
    proxy.mockResolvedValueOnce({ error: "not found" });
    const t = await tools();
    expect(await run(t.read_jira_issue, { issueKey: "A B/1" })).toEqual({ error: "not found" });
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0].endpoint).toContain("/issue/A%20B%2F1");
  });
});
