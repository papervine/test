import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { aiModel, aiModelId, aiProviderOptions, aiProviderStatus } from "@/lib/ai-model";
import { assistantTools } from "@/lib/assistant-tools";
import { contentContext, loadConfig, loadPage } from "@papervine/renderer/lib/content";
import {
  requestContentSource,
  requestReaderAccess,
  requestSearchIndexKey,
  requestSiteRecord,
} from "@/lib/request-source";
import { withReaderAccess, currentPageAccess } from "@/lib/reader-access";
import { withSearchIndexKey } from "@/lib/search";
import { getSiteByHost } from "@/lib/tenant";
import { logEvent, setEventStatus } from "@/lib/track";
import { outcomeFromText } from "@/lib/assistant-outcome";
import { aiRefusalResponse, authorizeAi, recordAiUsage } from "@/lib/billing/store";

/** Pull the user's question text out of a UIMessage (its text parts). */
function questionText(m: UIMessage | undefined): string {
  if (!m) return "";
  return (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * AI Assistant endpoint (SPEC §8). Agentic retrieval: Claude calls the docs tools
 * until it can answer, then streams the response (with inline citation links).
 */
export async function POST(req: Request) {
  const provider = aiProviderStatus();
  if (!provider.ok) {
    return Response.json(
      { error: `${provider.error} — the assistant is unavailable.` },
      { status: 503 },
    );
  }

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
  const src = await requestContentSource(site);
  // Gate every retrieval (searchDocs / readPage / listPages) by the reader's per-page access
  // (SPEC §11.2), so the assistant can't RAG over — or cite — pages the reader can't open.
  // The predicate rides an AsyncLocalStorage that propagates into the streamed tool calls
  // (same mechanism by which `contentContext` reaches them). Resolved from the reader cookie.
  const access = await requestReaderAccess(site);
  // Version key so the assistant's searchDocs reuses the cached index instead of rebuilding it
  // on every retrieval (live content; SPEC §6). Drafts are a different route and stay per-request.
  const indexKey = await requestSearchIndexKey(site);
  const run = <T,>(fn: () => Promise<T> | T): Promise<T> | T => {
    const inner = () => withReaderAccess(access, () => withSearchIndexKey(indexKey, fn));
    return src ? contentContext.run(src, inner) : inner();
  };

  return run(async () => {
    const config = await loadConfig();

    // Log the assistant query for analytics (SPEC §10.1). The outcome status is filled in once
    // the stream resolves (onFinish → answered/unanswered; onError → unanswered), so the
    // Assistant page's Answered/Not-answered split reflects reality.
    const site = await getSiteByHost(req.headers.get("host"));
    let eventId: string | null = null;
    if (site) {
      const q = questionText(messages[messages.length - 1]);
      if (q) eventId = await logEvent({ siteId: site.id, type: "assistant", source: "human", query: q });
    }

    // Current-page context: ground answers in what the reader is looking at (SPEC §8.1).
    // `pageSlug` is client-supplied, so gate it by the reader's access (it runs inside `run`,
    // which set the predicate) — a spoofed slug must not even leak a gated page's title.
    let pageContext = "";
    if (pageSlug) {
      const page = await loadPage(pageSlug.replace(/^\//, ""));
      if (page && currentPageAccess()(page.frontmatter)) {
        pageContext = ` The user is currently on the page "${
          page.frontmatter.title ?? pageSlug
        }" (${pageSlug}); prefer it when the question is about "this".`;
      }
    }

    const system =
      `You are the documentation assistant for "${config.name}". ` +
      `Answer using ONLY the documentation, which you retrieve with your tools. ` +
      `Always call searchDocs (and readPage / searchApi as needed) before answering. ` +
      `Cite every claim as an inline Markdown link to the page you used, e.g. [Quickstart](/quickstart). ` +
      `If the documentation does not contain the answer, say so plainly rather than guessing. ` +
      `Be concise and use Markdown.` +
      pageContext;

    const model = aiModelId();
    const result = streamText({
      model: aiModel(model),
      system,
      messages: await convertToModelMessages(messages),
      tools: assistantTools,
      providerOptions: aiProviderOptions(model),
      stopWhen: stepCountIs(8),
      // Record the outcome on the logged event so the Assistant page's answered/unanswered
      // split is real. Fire-and-forget — never block or fail the stream on instrumentation.
      onFinish: ({ text, totalUsage }) => {
        if (eventId) void setEventStatus(eventId, outcomeFromText(text));
        // Meter the whole agentic run (all steps) against the owning org's credits.
        // Fire-and-forget, same rule as analytics: a metering failure drops the charge,
        // never the answer (billing/store.ts).
        if (record && billing.metered) {
          void recordAiUsage({
            organizationId: record.organizationId,
            siteId: record.id,
            feature: "assistant",
            model,
            tokensIn: totalUsage.inputTokens ?? 0,
            tokensOut: totalUsage.outputTokens ?? 0,
            requestId: eventId,
          });
        }
      },
      onError: () => {
        if (eventId) void setEventStatus(eventId, "unanswered");
      },
    });

    return result.toUIMessageStreamResponse();
  });
}
