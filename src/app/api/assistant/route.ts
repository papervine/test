import type { UIMessage } from "ai";
import { aiProviderStatus } from "@papervine/renderer/lib/ai-model";
import { hostedAssistantHooks } from "@/lib/assistant-hooks";
import { runAssistantConversation } from "@papervine/renderer/lib/assistant-run";
import {
  requestContentSource,
  requestReaderAccess,
  requestSearchIndexKey,
  requestSiteRecord,
} from "@/lib/request-source";
import { aiRefusalResponse, authorizeAi } from "@/lib/billing/store";
import { rateLimited } from "@/lib/rate-limit";
import { checkRateLimit } from "@/lib/rate-limit-store";

/**
 * AI Assistant endpoint (SPEC §8). Agentic retrieval: Claude calls the docs tools
 * until it can answer, then streams the response (with inline citation links).
 */
export async function POST(req: Request) {
  const { messages, pageSlug, site } = (await req.json()) as {
    messages: UIMessage[];
    pageSlug?: string;
    site?: string;
  };

  // Operational kill switch (SPEC §8.6): a tenant that disabled its assistant answers nothing,
  // enforced here too so hiding the launcher (render-tenant.tsx) can't be bypassed by calling
  // the endpoint directly. Only blocks a positively-resolved disabled tenant — the apex/preview
  // host (record null) keeps the platform's own docs assistant working.
  const record = await requestSiteRecord(site);

  // Per-visitor rate limit. This is the only thing standing between a stranger and our model
  // budget on the apex, where `record` is null and the billing gate below is skipped by design.
  // Keyed per site so one tenant's busy office NAT can't lock readers out of another's docs.
  //
  // Runs BEFORE the provider check on purpose: with no AI configured every request would 503
  // and the limit would never be reached, which is exactly the state CI runs in.
  const limit = await checkRateLimit(`assistant:${record?.id ?? "apex"}`, req);
  if (!limit.allowed) return rateLimited(limit.retryAfterSec);

  const provider = aiProviderStatus();
  if (!provider.ok) {
    return Response.json(
      { error: `${provider.error} — the assistant is unavailable.` },
      { status: 503 },
    );
  }

  // The kill switch itself (see the record lookup above for why it's tenant-only).
  if (record && !record.assistantEnabled) {
    return Response.json(
      { error: "The assistant is disabled for this site." },
      { status: 403 },
    );
  }

  // Billing gate (SPEC §10 Billing): the owning org's plan must include the assistant
  // and have spendable credits. Tenant sites only — the platform's own docs (record
  // null) are unmetered. The lookup fails OPEN on DB errors and only `metered:true`
  // results get charged (billing must never take down a paid surface — billing/core.ts).
  const billing = record
    ? await authorizeAi(record.organizationId, "assistant")
    : ({ allowed: true, metered: false } as const);
  if (!billing.allowed) return aiRefusalResponse(billing.code);

  // Scope every content read — config, current page, and the streaming tool calls
  // (searchDocs / readPage / searchApi) — to the requesting tenant. Without this the
  // route falls back to the default fsSource and answers about the apex Papervine docs
  // instead of the site the reader is on (same per-request content-source trap the root
  // layout and tenant page solve via `contentContext.run`; see request-source.ts).
  // `site` (sent by the client in path mode) wins; otherwise fall back to the Host
  // header (subdomain mode), since middleware doesn't rewrite `/api/*`.
  const contentSource = await requestContentSource(site);
  // Gate every retrieval (searchDocs / readPage / listPages) by the reader's per-page access
  // (SPEC §11.2), so the assistant can't RAG over — or cite — pages the reader can't open.
  // The predicate rides an AsyncLocalStorage that propagates into the streamed tool calls
  // (same mechanism by which `contentContext` reaches them). Resolved from the reader cookie.
  const readerAccess = await requestReaderAccess(site);
  // Version key so the assistant's searchDocs reuses the cached index instead of rebuilding it
  // on every retrieval (live content; SPEC §6). Drafts are a different route and stay per-request.
  const searchIndexKey = await requestSearchIndexKey(site);

  return runAssistantConversation({
    record,
    billing,
    messages,
    pageSlug,
    contentSource,
    readerAccess,
    searchIndexKey,
    hooks: hostedAssistantHooks,
  });
}
