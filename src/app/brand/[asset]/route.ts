import { promises as fs } from "node:fs";
import path from "node:path";
import { BRAND_ASSETS } from "@/lib/brand";

/**
 * Papervine's own brand assets at stable URLs: `/brand/logotype.svg`, `/brand/mark.svg`,
 * `/brand/favicon.ico`, the PWA icon set, `/brand/site.webmanifest`. See `src/lib/brand.ts` for
 * why this is a route rather than files in `public/` (there isn't one) and how the URL space
 * survives the host rewrites.
 *
 * Public and CORS-open by design — the point of a logotype URL is that someone else's page, README
 * or slide can reference it.
 */
const BRAND_DIR = path.join(process.cwd(), "src", "assets", "brand");

// A year of browser caching would be wrong (the same URL can get new artwork), and no caching
// would be silly for a logo. A day, with a week of stale-while-revalidate, means a brand refresh
// propagates on its own without anyone purging anything.
const CACHE = "public, max-age=86400, stale-while-revalidate=604800";

export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  // The segment is a KEY into the allowlist, never a path — so there is no traversal to guard.
  const entry = BRAND_ASSETS[asset];
  if (!entry) return new Response("Not found", { status: 404 });

  try {
    const data = await fs.readFile(path.join(BRAND_DIR, entry.file));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": entry.text ? `${entry.type}; charset=utf-8` : entry.type,
        "Cache-Control": CACHE,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    // A missing file here is a packaging bug (outputFileTracingIncludes), not a bad request —
    // 404 rather than 500, but the log line is what tells you which.
    console.error(`brand: ${entry.file} is not in the deployment`);
    return new Response("Not found", { status: 404 });
  }
}
