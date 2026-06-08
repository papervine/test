import { anthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { assistantTools } from "@/lib/assistant-tools";
import { loadConfig, loadPage } from "@/lib/content";

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

  const { messages, pageSlug } = (await req.json()) as {
    messages: UIMessage[];
    pageSlug?: string;
  };

  const config = await loadConfig();

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
    model: anthropic(process.env.DOCBOT_AI_MODEL ?? "claude-sonnet-4-6"),
    system,
    messages: await convertToModelMessages(messages),
    tools: assistantTools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
