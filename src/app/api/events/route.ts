import { type NextRequest } from "next/server";
import { z } from "zod";
import { getSiteByHost } from "@/lib/tenant";
import { logEvent, normalizeReferrer } from "@/lib/track";

/**
 * Human page-view beacon (SPEC §10.1). The docs client (`PageViewBeacon`) POSTs
 * here on navigation. Humans run JS → land here; agents/crawlers don't, so this is
 * the "human" half of the Humans-vs-Agents split. The site is derived from the
 * request host (never trusted from the body); no tenant host = no-op.
 */
const Body = z.object({
  path: z.string().max(1024),
  sessionId: z.string().max(64).optional(),
  referrer: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const site = await getSiteByHost(req.headers.get("host"));
  if (!site) return new Response(null, { status: 204 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 204 });

  const { path, sessionId, referrer } = parsed.data;
  await logEvent({
    siteId: site.id,
    type: "page_view",
    source: "human",
    path: path.split(/[?#]/)[0], // strip query/hash for clean top-pages grouping
    referrer: normalizeReferrer(
      referrer || req.headers.get("referer"),
      req.headers.get("host"),
    ),
    sessionId: sessionId ?? null,
  });

  return new Response(null, { status: 204 });
}
