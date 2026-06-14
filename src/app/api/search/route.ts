import { NextResponse, type NextRequest } from "next/server";
import { contentContext } from "@papervine/renderer/lib/content";
import { requestContentSource } from "@/lib/request-source";
import { runSearch } from "@/lib/search";

/** Full-text search endpoint (SPEC.md §6). `GET /api/search?q=…`. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";

  // Scope the index to the requesting tenant — middleware doesn't rewrite `/api/*`, so
  // without entering the tenant's content source here `runSearch` falls back to the apex
  // Papervine docs and the tenant's Cmd+K returns our pages (same trap the assistant
  // route and root layout solve; see request-source.ts). The `site` param (sent by the
  // client in path mode) wins; otherwise fall back to the Host header (subdomain mode).
  const src = await requestContentSource(req.nextUrl.searchParams.get("site") ?? undefined);
  const results = src
    ? await contentContext.run(src, () => runSearch(q))
    : await runSearch(q);

  // Analytics is NOT logged here: this fires once per keystroke-debounce, so it would
  // count every prefix the user types through. The reader logs a single search *intent*
  // on settle / result-click via POST /api/search/track. See src/lib/search-track.ts.
  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
