import { NextResponse, type NextRequest } from "next/server";
import { runSearch } from "@/lib/search";
import { getSiteByHost } from "@/lib/tenant";
import { logEvent } from "@/lib/track";

/** Full-text search endpoint (SPEC.md §6). `GET /api/search?q=…`. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await runSearch(q);

  // Log the search for analytics (SPEC §10.1). Only meaningful queries on a real
  // tenant; never blocks the response.
  if (q.trim()) {
    const site = await getSiteByHost(req.headers.get("host"));
    if (site)
      await logEvent({ siteId: site.id, type: "search", source: "human", query: q });
  }

  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
