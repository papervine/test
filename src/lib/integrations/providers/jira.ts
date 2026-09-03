import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { ToolSet } from "ai";
import { proxy, connectionConfig } from "../nango";

/**
 * Jira read tools for the agent (SPEC §10.2 connector tool layer).
 *
 * Read-only: search issues, read one with its comments. Nothing that transitions, edits
 * or comments — the agent's only write path is the §9.2 authoring backend, over docs.
 *
 * Two Jira Cloud specifics that are easy to get wrong and fail loudly in production:
 *
 *  1. **The path carries the site's `cloudId`** (`/ex/jira/{cloudId}/rest/api/3/…`).
 *     Nango resolves it at connect time into the connection config rather than exposing a
 *     stable base URL, so it has to be read per connection and spliced in.
 *  2. **`GET /rest/api/3/search` is gone** — it returns 410 on Cloud since the 2025
 *     sunset. The replacement is `POST /rest/api/3/search/jql`, which pages by opaque
 *     `nextPageToken` (no `startAt`, no `total`) and, unlike the old one, returns NO
 *     fields unless you name them.
 */

// Named explicitly because /search/jql returns nothing but ids otherwise. Kept small: a
// search result needs to be enough to choose from, not enough to answer from.
const SEARCH_FIELDS = ["summary", "status", "issuetype", "assignee", "updated", "priority"];
const MAX_CHARS = 20_000;

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};
type IssueFields = {
  summary?: string;
  description?: AdfNode | string | null;
  status?: { name?: string };
  issuetype?: { name?: string };
  priority?: { name?: string };
  assignee?: { displayName?: string } | null;
  reporter?: { displayName?: string } | null;
  updated?: string;
  labels?: string[];
};
type Issue = { key: string; fields?: IssueFields };
type Comment = {
  author?: { displayName?: string };
  created?: string;
  body?: AdfNode | string;
};

/**
 * Atlassian Document Format → text. ADF is a node tree (the same shape Confluence uses),
 * so a description arrives as nested paragraphs and marks rather than a string. Kept to
 * the structures that carry meaning in an issue; anything unknown still contributes its
 * text, so a new node type degrades to plain prose instead of vanishing.
 */
function adfToText(node: AdfNode | string | null | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node; // some fields come back already flat
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "rule") return "\n---\n";
  // A mention renders as a bare account id without this, which is noise in a thread.
  if (node.type === "mention") return `@${(node.attrs?.text as string) ?? "someone"}`;
  if (node.type === "emoji") return (node.attrs?.shortName as string) ?? "";
  if (node.type === "inlineCard" || node.type === "blockCard") {
    return (node.attrs?.url as string) ?? "";
  }

  const inner = (node.content ?? []).map((c) => adfToText(c)).join("");
  switch (node.type) {
    case "paragraph":
      return `${inner}\n`;
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${inner}\n`;
    }
    case "bulletList":
    case "orderedList":
      return inner;
    case "listItem":
      return `- ${inner.trim()}\n`;
    case "codeBlock":
      return `\`\`\`${(node.attrs?.language as string) ?? ""}\n${inner}\n\`\`\`\n`;
    case "blockquote":
      return `> ${inner.trim()}\n`;
    case "mediaSingle":
    case "mediaGroup":
      return ""; // images and attachments: nothing readable to give
    default:
      return inner;
  }
}

function describe(issue: Issue) {
  const f = issue.fields ?? {};
  return {
    key: issue.key,
    summary: f.summary,
    status: f.status?.name,
    type: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName ?? "Unassigned",
    updated: f.updated,
  };
}

export function jiraTools(organizationId: string): ToolSet {
  // Resolved once per run and reused: the cloudId is stable for a connection, and paying
  // a round trip for it on every tool call would double the latency of a two-call answer.
  let cloudIdPromise: Promise<string | null> | null = null;
  const cloudId = () => {
    cloudIdPromise ??= connectionConfig(organizationId, "jira").then(
      (config) => config.cloudId ?? null,
    );
    return cloudIdPromise;
  };

  const call = async <T>(
    path: string,
    opts: {
      method?: "GET" | "POST";
      params?: Record<string, string | number | boolean>;
      data?: unknown;
    } = {},
  ): Promise<{ data: T } | { error: string }> => {
    const id = await cloudId();
    if (!id) {
      return {
        error: "This Jira connection has no cloudId — reconnect Jira from Automate › Agent.",
      };
    }
    return proxy<T>({
      organizationId,
      provider: "jira",
      endpoint: `/ex/jira/${id}/rest/api/3${path}`,
      ...opts,
    });
  };

  return {
    search_jira_issues: tool({
      description:
        "Search Jira issues with JQL. Returns key, summary, status, type and assignee. " +
        "Use before read_jira_issue. Example JQL: project = DOCS AND status != Done " +
        "ORDER BY updated DESC.",
      inputSchema: z.object({
        jql: z
          .string()
          .describe(
            "A JQL query. Prefer ORDER BY updated DESC for recency. Quote values containing spaces.",
          ),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 20)."),
      }),
      execute: async ({ jql, limit }) => {
        const res = await call<{ issues?: Issue[]; nextPageToken?: string }>("/search/jql", {
          method: "POST",
          data: { jql, fields: SEARCH_FIELDS, maxResults: limit ?? 20 },
        });
        if ("error" in res) return { error: res.error };

        const issues = (res.data.issues ?? []).map(describe);
        return issues.length
          ? {
              issues,
              // Cursor pagination: there is no total to report, so "more exist" is the
              // only honest thing to say about the rest.
              ...(res.data.nextPageToken ? { note: "More issues match this query." } : {}),
            }
          : { issues: [], note: "No issues matched that JQL." };
      },
    }),

    read_jira_issue: tool({
      description:
        "Read a Jira issue by key (e.g. DOCS-42), including its description and comments.",
      inputSchema: z.object({
        issueKey: z.string().describe("The issue key, e.g. DOCS-42."),
        includeComments: z
          .boolean()
          .optional()
          .describe("Fetch the comment thread too (default true)."),
      }),
      execute: async ({ issueKey, includeComments = true }) => {
        const key = encodeURIComponent(issueKey);
        const res = await call<Issue>(`/issue/${key}`, {
          params: {
            fields:
              "summary,description,status,issuetype,priority,assignee,reporter,updated,labels",
          },
        });
        if ("error" in res) return { error: res.error };

        const f = res.data.fields ?? {};
        const description = adfToText(f.description).trim();
        const base = {
          key: res.data.key,
          summary: f.summary,
          status: f.status?.name,
          type: f.issuetype?.name,
          priority: f.priority?.name,
          assignee: f.assignee?.displayName ?? "Unassigned",
          reporter: f.reporter?.displayName,
          labels: f.labels,
          updated: f.updated,
          description: description.slice(0, MAX_CHARS),
          ...(description.length > MAX_CHARS ? { truncated: true } : {}),
        };
        if (!includeComments) return base;

        // A separate endpoint by design: the discussion is usually where the actual
        // answer lives, but it's also the bulk of the payload, hence opt-out-able.
        const comments = await call<{ comments?: Comment[] }>(`/issue/${key}/comment`, {
          params: { maxResults: 20, orderBy: "-created" },
        });
        // A readable issue with unreadable comments is still worth returning: report the
        // comment failure alongside it rather than losing the issue to it.
        if ("error" in comments) return { ...base, commentsError: comments.error };
        return {
          ...base,
          comments: (comments.data.comments ?? []).map((c) => ({
            author: c.author?.displayName,
            created: c.created,
            body: adfToText(c.body).trim().slice(0, 4000),
          })),
        };
      },
    }),
  };
}
