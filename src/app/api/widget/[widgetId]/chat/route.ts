import type { UIMessage } from "ai";
import { aiProviderStatus } from "@/lib/ai-model";
import { runAssistantConversation } from "@/lib/assistant-run";
import { requestContentSource, requestReaderAccess, requestSearchIndexKey } from "@/lib/request-source";
import { aiRefusalResponse, authorizeAi } from "@/lib/billing/store";
import { getSiteByWidgetId } from "@/lib/tenant";
import { isOriginAllowed, resolveDocsBaseUrl } from "@/lib/widget";

/**
 * The embeddable assistant widget's chat endpoint (SPEC §8.7) — the cross-origin
 * counterpart to /api/assistant. A third-party page's Host is the CUSTOMER's domain, not
 * ours, so the tenant is resolved from the public widgetId in the URL instead of Host/
 * cookie, and every request is validated against the site's configured origin allowlist
 * (there's no reader session to trust across origins — see the `{ anonymous: true }` call
 * below). `runAssistantConversation` (src/lib/assistant-run.ts) carries the actual
 * conversation logic shared with /api/assistant; this route only adds what's genuinely
 * different for a public, cross-origin caller: origin enforcement, CORS headers, and
 * resolving the tenant by widgetId.
 */

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // Without this, browsers cache a preflight for only a few seconds (Chromium) or not
    // at all — meaning every message in a conversation re-triggers an OPTIONS round-trip
    // before the real POST. 86400s (24h, the practical browser cap) means only the first
    // message of the day pays for a preflight. Harmless on non-preflight responses too
    // (this helper backs both) — browsers simply ignore it there.
    "Access-Control-Max-Age": "86400",
    // A custom response header is invisible to client JS on a cross-origin fetch unless
    // explicitly exposed — without this, res.headers.get("X-Papervine-Docs-Base") reads
    // null in the browser even though the header is present on the wire.
    "Access-Control-Expose-Headers": "X-Papervine-Docs-Base",
    Vary: "Origin",
  };
}

function withCors(res: Response, origin: string): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

export async function OPTIONS(
  req: Request,
  { params }: { params: Promise<{ widgetId: string }> },
) {
  const { widgetId } = await params;
  const origin = req.headers.get("origin");
  const site = await getSiteByWidgetId(widgetId);
  if (!site?.widgetEnabled || !isOriginAllowed(origin, site.widgetAllowedOrigins)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin!) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ widgetId: string }> },
) {
  const { widgetId } = await params;
  const origin = req.headers.get("origin");

  const site = await getSiteByWidgetId(widgetId);
  if (!site) {
    return Response.json({ error: "Unknown widget." }, { status: 404 });
  }
  // Opaque to a non-allowlisted origin (no CORS headers — the browser blocks it, and we
  // don't confirm/deny details beyond that). An already-allowed origin gets a real reason.
  if (!isOriginAllowed(origin, site.widgetAllowedOrigins)) {
    return Response.json({ error: "This origin isn't authorized for this widget." }, { status: 403 });
  }
  if (!site.widgetEnabled) {
    return withCors(
      Response.json({ error: "This widget is disabled." }, { status: 403 }),
      origin!,
    );
  }

  const provider = aiProviderStatus();
  if (!provider.ok) {
    return withCors(
      Response.json(
        { error: `${provider.error} — the assistant is unavailable.` },
        { status: 503 },
      ),
      origin!,
    );
  }

  const { messages, pageSlug } = (await req.json()) as {
    messages: UIMessage[];
    pageSlug?: string;
  };

  const billing = await authorizeAi(site.organizationId, "assistant");
  if (!billing.allowed) return withCors(aiRefusalResponse(billing.code), origin!);

  const contentSource = await requestContentSource(site.slug);
  // Widget visitors carry no reader session across origins — always the anonymous,
  // public-only predicate (same reasoning as the MCP server): a gated page must never
  // leak through a public, unauthenticated embed.
  const readerAccess = await requestReaderAccess(site.slug, { anonymous: true });
  const searchIndexKey = await requestSearchIndexKey(site.slug);

  const res = await runAssistantConversation({
    record: site,
    billing,
    messages,
    pageSlug,
    contentSource,
    readerAccess,
    searchIndexKey,
  });
  const withCorsRes = withCors(res, origin!);
  withCorsRes.headers.set(
    "X-Papervine-Docs-Base",
    resolveDocsBaseUrl(req.headers.get("host") ?? "", site),
  );
  return withCorsRes;
}
