import "server-only";
import { type NextRequest } from "next/server";
import { requestContentSource, requestReaderAccess } from "./request-source";
import { withReaderAccess } from "./reader-access";
import { contentContext } from "@papervine/renderer/lib/content";
import { renderPageMarkdown } from "@papervine/renderer/lib/page-md";
import { llmsDiscoveryHeaders } from "./llms-route";
import { logAgentVisit } from "./agent-visit";
import { READER_COOKIE } from "./reader-session";

/**
 * Serve one page's Markdown twin for the tenant in scope (SPEC §9.1). The body is built by
 * the renderer (`renderPageMarkdown`, shared with the CLI); this is the multi-tenant wrapper
 * — tenant resolution, reader access, agent analytics, caching.
 */
export async function handlePageMdRequest(req: NextRequest, slug: string): Promise<Response> {
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const src = await requestContentSource();
  // Unlike /llms.txt (a corpus dump, always anonymous), a single page honors the reader's real
  // session: a signed-in reader gets the gated page they can already read in the browser, and
  // an anonymous client gets the same 404 the HTML route gives (SPEC §11.2).
  const access = await requestReaderAccess();
  const render = () => withReaderAccess(access, () => renderPageMarkdown(slug));

  let body: string | null;
  try {
    body = src ? await contentContext.run(src, render) : await render();
  } catch {
    body = null;
  }
  if (body === null) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  logAgentVisit(req, `/${slug}.md`);

  // Cache publicly ONLY for anonymous requests. This response varies by reader session, so a
  // shared `s-maxage` on a signed-in reader's fetch would let a CDN hand a gated page to the
  // next anonymous client — the leak `withReaderAccess` exists to prevent, reintroduced one
  // layer up. Presence of the cookie is the right test (not the resolved access): it's what
  // makes the response client-specific, whether or not the session turns out to be valid.
  const perReader = Boolean(req.cookies.get(READER_COOKIE));
  const headers = llmsDiscoveryHeaders(
    new Headers({
      "content-type": "text/markdown; charset=utf-8",
      // Otherwise: cheap to regenerate, identical for every client, and crawled in bursts.
      "cache-control": perReader
        ? "private, no-store"
        : "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    }),
  );
  // Cite the URL a human should open, so a client quoting the Markdown links to the page.
  headers.append("link", `<${origin}${slug === "" ? "/" : `/${slug}`}>; rel="canonical"`);
  return new Response(body, { headers });
}
