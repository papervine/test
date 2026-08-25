import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { headers } from "next/headers";
import { searchDocs, readPage, listPages } from "@papervine/renderer/lib/docs-tools";
import { contentContext } from "@papervine/renderer/lib/content";
import { findSite } from "@/lib/dashboard-context";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSeeFeature } from "@/lib/features";
import { draftContentSource } from "@/lib/authoring-tools";
import {
  resolvePagePath,
  saveDraft,
  publishDraft,
  checkoutBranch,
} from "@/lib/authoring-core";

/**
 * Authoring MCP (SPEC §9.2) — the agent-native counterpart to the web editor, the SECOND
 * transport over the same authoring backend (the editing-agent chat is the first). External
 * AI clients read AND edit a site's docs on a draft branch; edits land via the same draft
 * buffer + publish (commit/PR) path the human editor uses.
 *
 * Unlike the public read MCP (`/mcp`), this WRITES, so it's authenticated: a signed-in org
 * member with the editor feature, identified by the session cookie (app host). The target
 * site + branch come from request headers (`x-papervine-org`, `x-papervine-site`,
 * `x-papervine-branch`). Token-scoped external auth (a platform-auth PAT, SPEC §11) is the
 * follow-up; this is the authenticated-session slice.
 */
const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const err = (message: string) => json({ error: message });

/**
 * Transport note: this uses the SDK's Web-standard Streamable HTTP transport directly rather than
 * `mcp-handler`. That package exists to bridge the SDK's Node-`IncomingMessage` transport to a
 * Fetch handler, and it declares `redis` as a runtime dependency which it imports eagerly —
 * `handleRequest(req: Request): Promise<Response>` is already a route handler's contract, so there
 * was nothing to bridge and a 4MB Redis client left the tree with it.
 *
 * The tool bodies below are unchanged, including their `server.tool(...)` calls. That overload is
 * marked `@deprecated` in favour of `registerTool`, and converting them is worth doing — but not
 * in the same change as a transport swap, on an authenticated surface that writes to Git.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const server = new McpServer(
    { name: "Papervine Authoring", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  {
    const h = await headers();
    const org = h.get("x-papervine-org");
    const siteSlug = h.get("x-papervine-site");

    // Authorize once per connection. If anything fails, the tools still mount but refuse —
    // an MCP client gets a clear error rather than a dead endpoint.
    const session = await getSession();
    const organization = org ? (await listOrganizations())?.find((o) => o.slug === org) : null;
    const role =
      session && organization ? await getMemberRole(organization.id, session.user.id) : null;
    const site =
      session && org && siteSlug && canSeeFeature("editor.workspace", role)
        ? await findSite(org, siteSlug)
        : null;

    // Resolve / open the edit branch up front so every tool shares one session.
    let branch = h.get("x-papervine-branch") ?? "";
    if (site) {
      const res = await checkoutBranch(site, {
        actorUserId: session!.user.id,
        branchName: branch || undefined,
      });
      branch = res.branch;
    }

    const NOAUTH = "Not authorized. Sign in and set x-papervine-org / x-papervine-site headers.";
    const draft = <T>(s: NonNullable<typeof site>, fn: () => Promise<T>): Promise<T> =>
      contentContext.run(draftContentSource(s, branch), fn);

    server.tool(
      "read",
      "Read a documentation page's raw MDX by slug (draft-aware).",
      { slug: z.string() },
      async ({ slug }) => {
        if (!site) return err(NOAUTH);
        return draft(site, async () => json(await readPage(slug)));
      },
    );

    server.tool(
      "search",
      "Full-text search this documentation (draft-aware).",
      { query: z.string() },
      async ({ query }) => {
        if (!site) return err(NOAUTH);
        return draft(site, async () => json(await searchDocs(query)));
      },
    );

    server.tool(
      "list_pages",
      "List every documentation page (title + href).",
      {},
      async () => {
        if (!site) return err(NOAUTH);
        return draft(site, async () => json(await listPages()));
      },
    );

    server.tool(
      "write_page",
      "Create or replace a page with full MDX (frontmatter included). Buffers to the draft branch.",
      { slug: z.string(), content: z.string() },
      async ({ slug, content }) => {
        if (!site) return err(NOAUTH);
        const { path } = await resolvePagePath(site, branch, slug);
        await saveDraft(site, branch, path, content);
        return json({ ok: true, slug, branch });
      },
    );

    server.tool(
      "edit_page",
      "Targeted edit: replace the first occurrence of `find` with `replace` in a page's raw MDX.",
      { slug: z.string(), find: z.string(), replace: z.string() },
      async ({ slug, find, replace }) => {
        if (!site) return err(NOAUTH);
        const { path, raw } = await resolvePagePath(site, branch, slug);
        if (raw === null) return err(`No page "${slug}".`);
        if (!raw.includes(find)) return err(`Text not found in "${slug}".`);
        await saveDraft(site, branch, path, raw.replace(find, replace));
        return json({ ok: true, slug, branch });
      },
    );

    server.tool(
      "save",
      "Publish the draft: mode 'pr' opens a pull request (default), 'commit' writes to the deploy branch.",
      { mode: z.enum(["pr", "commit"]), message: z.string().optional() },
      async ({ mode, message }) => {
        if (!site) return err(NOAUTH);
        return json(await publishDraft(site, branch, { mode, message }));
      },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
