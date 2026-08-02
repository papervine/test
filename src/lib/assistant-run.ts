import "server-only";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { aiModel, aiModelId, aiProviderOptions } from "@/lib/ai-model";
import { assistantTools } from "@/lib/assistant-tools";
import {
  contentContext,
  loadConfig,
  loadPage,
  type ContentSource,
} from "@papervine/renderer/lib/content";
import type { PageAccess } from "@papervine/renderer/lib/nav";
import { withReaderAccess, currentPageAccess } from "@/lib/reader-access";
import { withSearchIndexKey } from "@/lib/search";
import { logEvent, setEventStatus } from "@/lib/track";
import { outcomeFromText } from "@/lib/assistant-outcome";
import { recordAiUsage } from "@/lib/billing/store";
import type { site } from "@/lib/db/app-schema";

type SiteRecord = typeof site.$inferSelect;

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
 * The assistant conversation itself (SPEC §8): tenant-scoped content retrieval, the
 * agentic `streamText` call, and billing/analytics instrumentation — shared by the
 * in-docs `/api/assistant` route and the cross-origin `/api/widget/[widgetId]/chat`
 * route (SPEC §8.7). Everything caller-transport-specific (request parsing, the
 * assistantEnabled/widgetEnabled kill switch, CORS) stays in the calling route; this is
 * only the part where a bug (e.g. a billing-metering mistake) must not drift between
 * the two callers.
 */
export async function runAssistantConversation(params: {
  record: SiteRecord | null;
  // The caller must have already checked `billing.allowed` (aiRefusalResponse handles the
  // rejection) — this only ever runs the conversation that's been cleared to happen.
  billing: { allowed: true; metered: boolean };
  messages: UIMessage[];
  pageSlug?: string;
  contentSource: ContentSource | null;
  readerAccess: PageAccess;
  searchIndexKey: string | null;
}): Promise<Response> {
  const { record, billing, messages, pageSlug, contentSource, readerAccess, searchIndexKey } =
    params;

  const run = <T,>(fn: () => Promise<T> | T): Promise<T> | T => {
    const inner = () => withReaderAccess(readerAccess, () => withSearchIndexKey(searchIndexKey, fn));
    return contentSource ? contentContext.run(contentSource, inner) : inner();
  };

  return run(async () => {
    const config = await loadConfig();

    // Log the query for analytics (SPEC §10.1). The outcome status is filled in once the
    // stream resolves (onFinish → answered/unanswered; onError → unanswered), so the
    // Assistant page's Answered/Not-answered split reflects reality. Uses `record` (the
    // already-resolved tenant) rather than re-deriving from the request Host header — the
    // widget's Host is the CUSTOMER's domain, not ours, so a Host-based lookup would log
    // against the wrong site (or nothing) for every widget query.
    let eventId: string | null = null;
    if (record) {
      const q = questionText(messages[messages.length - 1]);
      if (q) eventId = await logEvent({ siteId: record.id, type: "assistant", source: "human", query: q });
    }

    // Current-page context: ground answers in what the reader is looking at (SPEC §8.1).
    // `pageSlug` is client-supplied, so gate it by the reader's access (it runs inside
    // `run`, which set the predicate) — a spoofed slug must not even leak a gated page's
    // title.
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
