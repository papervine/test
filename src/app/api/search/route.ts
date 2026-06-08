import { NextResponse, type NextRequest } from "next/server";
import { runSearch } from "@/lib/search";

/** Full-text search endpoint (SPEC.md §6). `GET /api/search?q=…`. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await runSearch(q);
  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
