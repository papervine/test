import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { headers } from "next/headers";
import { searchDocs, readPage, listPages } from "@papervine/renderer/lib/docs-tools";
import { contentContext } from "@papervine/renderer/lib/content";
import {
  resolveActorUserId,
  resolveAuthoringTarget,
  denialMessage,
} from "@/lib/authoring-auth";
import { requestOrigin } from "@/lib/mcp-oauth-metadata";
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
 * Unlike the public read MCP (`/mcp`), this WRITES, so it's authenticated: an org member whose
 * role clears the editor feature. Two credentials are accepted, resolved in
 * `@/lib/authoring-auth`:
 *
 *   - an **OAuth 2.1 access token** from Better Auth's `mcp` plugin — what an MCP client uses,
 *     obtained by the standard discovery + authorize flow (a browser tab, one approval);
 *   - the **dashboard session cookie**, for a browser already signed in on the app host.
 *
 * The token half is what makes this surface usable at all. Before it, the only accepted
 * credential was a cookie no MCP client can send, so the write MCP was reachable only from a
 * signed-in browser — that is, not by the tools it exists for.
 *
 * The target site + branch still come from request headers (`x-papervine-org`,
 * `x-papervine-site`, `x-papervine-branch`): the OAuth grant identifies the *person*, and a
 * person's sites change without their token needing to.
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

/**
 * Where a client should look up who can issue tokens for this resource.
 *
 * Built from the request's `Host`, not from `req.url` and not from a configured base URL. This
 * route answers on the app host, on preview deployments, and on `app.localhost:<port>` in dev,
 * and a client that reached one of those must not be sent to another — its session cookie is
 * host-only and wouldn't follow. `req.url` looks like it would work and doesn't: inside a Next
 * route handler it carries the server's internal origin, so a request to `app.localhost:3001`
 * produced a challenge pointing at `localhost:3001` (i.e. the apex, where there is no session).
 */
function protectedResourceUrl(req: Request): string {
  return `${requestOrigin(req)}/.well-known/oauth-protected-resource`;
}

async function handle(req: Request): Promise<Response> {
  const h = await headers();
  const userId = await resolveActorUserId(h);

  // No credential at all → 401 with `WWW-Authenticate`, which is the MCP authorization spec's
  // signal for "go get a token": a client reads `resource_metadata`, fetches it, discovers the
  // authorization server, and runs the OAuth flow. Answering 200-with-a-refusing-tool instead
  // (what this did before) is a dead end — the client has been told it can proceed, so it never
  // starts the flow and the user just sees every tool fail.
  //
  // Only the *unauthenticated* case is a 401. A known user asking about a site they can't reach
  // is a normal tool error, below: their credential is fine and re-authorizing won't help.
  if (!userId) {
    return new Response(
      JSON.stringify({ error: denialMessage("unauthenticated") }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${protectedResourceUrl(req)}"`,
        },
      },
    );
  }

  const server = new McpServer(
    { name: "Papervine Authoring", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  {
    // Authorize the target once per connection. If it fails, the tools still mount but refuse —
    // a client gets a named reason on the tool it called rather than a dead endpoint.
    const resolved = await resolveAuthoringTarget({
      userId,
      orgSlug: h.get("x-papervine-org"),
      siteSlug: h.get("x-papervine-site"),
    });
    const site = resolved.ok ? resolved.target.site : null;
    const NOAUTH = resolved.ok ? "" : denialMessage(resolved.denial);

    // Resolve / open the edit branch up front so every tool shares one session.
    let branch = h.get("x-papervine-branch") ?? "";
    if (resolved.ok) {
      const res = await checkoutBranch(resolved.target.site, {
        actorUserId: resolved.target.userId,
        branchName: branch || undefined,
      });
      branch = res.branch;
    }
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
