import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { assistantTools } from "@/lib/assistant-tools";
import { contentContext, loadConfig, loadPage } from "@/lib/content";
import { requestContentSource } from "@/lib/request-source";
import { getSiteByHost } from "@/lib/tenant";
import { logEvent } from "@/lib/track";

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set — the assistant is unavailable." },
      { status: 503 },
    );
  }

  const { messages, pageSlug, site } = (await req.json()) as {
    messages: UIMessage[];
    pageSlug?: string;
    site?: string;
  };

  // Scope every content read — config, current page, and the streaming tool calls
  // (searchDocs / readPage / searchApi) — to the requesting tenant. Without this the
  // route falls back to the default fsSource and answers about the apex Papervine docs
  // instead of the site the reader is on (same per-request content-source trap the root
  // layout and tenant page solve via `contentContext.run`; see request-source.ts).
  // `site` (sent by the client in path mode) wins; otherwise fall back to the Host
  // header (subdomain mode), since middleware doesn't rewrite `/api/*`.
  const src = await requestContentSource(site);
  const run = <T,>(fn: () => Promise<T> | T): Promise<T> | T =>
    src ? contentContext.run(src, fn) : fn();

  return run(async () => {
    const config = await loadConfig();

    // Log the assistant query for analytics (SPEC §10.1). Status (answered/unanswered)
    // is a follow-up once the stream resolves; the foundation just counts queries.
    const site = await getSiteByHost(req.headers.get("host"));
    if (site) {
      const q = questionText(messages[messages.length - 1]);
      if (q)
        await logEvent({ siteId: site.id, type: "assistant", source: "human", query: q });
    }

    // Current-page context: ground answers in what the reader is looking at (SPEC §8.1).
    let pageContext = "";
    if (pageSlug) {
      const page = await loadPage(pageSlug.replace(/^\//, ""));
      if (page) {
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

    const result = streamText({
      model: anthropic(process.env.PAPERVINE_AI_MODEL ?? "claude-sonnet-4-6"),
      system,
      messages: await convertToModelMessages(messages),
      tools: assistantTools,
      stopWhen: stepCountIs(8),
    });

    return result.toUIMessageStreamResponse();
  });
}
