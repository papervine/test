import { type NextRequest, NextResponse } from "next/server";
import { getSiteBySlug } from "@/lib/tenant";
import { getObjectBytes } from "@/lib/storage";

// Streams a tenant's static assets from object storage (SPEC §3.1 model C).
// Reached via the middleware tenant-host rewrite of /img/… → /api/tenant-asset/{slug}/…
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ site: string; path: string[] }> },
) {
  const { site, path } = await params;
  const record = await getSiteBySlug(site);
  if (!record) return new NextResponse("Not found", { status: 404 });

  const obj = await getObjectBytes(`sites/${record.id}/${path.join("/")}`);
  if (!obj) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "content-type": obj.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
    },
  });
}
