import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSiteByHost } from "@/lib/tenant";

// Tiny public identity endpoint: returns which site the *requesting host* resolves to.
// The Domain setup "Connected" check fetches https://{customDomain}/api/site-identity
// and confirms the slug matches — proving DNS actually points the vanity host at us and
// at the right site. Served directly on the tenant host (middleware doesn't rewrite /api).
export async function GET(_req: NextRequest) {
  const h = await headers();
  const host = h.get("x-papervine-host") ?? h.get("host");
  const record = await getSiteByHost(host);
  if (!record) return NextResponse.json({ site: null }, { status: 404 });
  return NextResponse.json({ site: record.slug });
}
