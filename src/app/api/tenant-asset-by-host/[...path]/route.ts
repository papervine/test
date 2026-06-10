import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSiteByCustomDomain } from "@/lib/tenant";
import { getObjectBytes } from "@/lib/storage";

// Streams a custom-domain site's static assets from object storage — the by-host
// analogue of /api/tenant-asset/{slug}/…. The middleware rewrites asset requests on a
// vanity host here (forwarding x-papervine-host) because the slug can't be resolved at
// the edge. See /custom-domain for the docs-page counterpart.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const h = await headers();
  const host = h.get("x-papervine-host") ?? h.get("host") ?? "";
  const record = await getSiteByCustomDomain(host);
  if (!record) return new NextResponse("Not found", { status: 404 });

  // In "Host at /docs" mode assets come through prefixed with the docs subpath
  // (assetBase = /docs); strip it back to the object key under sites/{id}/.
  let path = (await params).path;
  if (record.customDomainSubpath && path[0] === "docs") path = path.slice(1);

  const obj = await getObjectBytes(`sites/${record.id}/${path.join("/")}`);
  if (!obj) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(obj.body, {
    headers: {
      "content-type": obj.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=300",
    },
  });
}
