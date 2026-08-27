import { type NextRequest } from "next/server";
import { handlePageMdRequest } from "@/lib/page-md-route";

// A page's clean-Markdown twin, served at `<path>.md` (SPEC §9.1). The pretty URL is what
// /llms.txt links to; `middleware.ts` rewrites `*.md` here (extension matching isn't
// something the route tree can express) and stamps the tenant, the same way it routes the
// other agent surfaces.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const slug = (path ?? []).join("/");
  // `/index.md` is how the index page's Markdown is addressed — its own slug is "".
  return handlePageMdRequest(req, slug === "index" ? "" : slug);
}
