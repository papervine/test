// Rating an editing-agent response (SPEC §9.2): the good/bad buttons under each reply.
//
// Pure rules only — the API route validates with parseFeedbackBody, the panel derives the
// copied text and the question-for-analytics with the helpers — so all of it is unit-testable
// without a browser or a DB. The event lands in analytics_event as type='feedback' with
// path='/editor-agent' (the discriminator the reader-widget's future feedback won't carry).

export type AgentRating = "up" | "down";

export interface AgentFeedback {
  rating: AgentRating;
  /** The rated assistant message (the SDK's message id — opaque, per conversation). */
  messageId: string;
  /** The chat it belongs to — becomes the event's sessionId so ratings group per conversation. */
  chatId?: string;
  /** The user ask the rated reply answered — the analytics `query`, what makes a 'down' actionable. */
  question?: string;
}

/** Validate a feedback POST body. Returns null for anything malformed — the route 400s on null. */
export function parseFeedbackBody(body: unknown): AgentFeedback | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.rating !== "up" && b.rating !== "down") return null;
  if (typeof b.messageId !== "string" || !b.messageId) return null;
  const chatId = typeof b.chatId === "string" && b.chatId ? b.chatId : undefined;
  // Cap defensively: `query` is a text column, but a rating never needs a novel.
  const question =
    typeof b.question === "string" && b.question.trim()
      ? b.question.trim().slice(0, 2000)
      : undefined;
  return { rating: b.rating, messageId: b.messageId, chatId, question };
}

type PartLike = { type: string; text?: string };
type MessageLike = { id: string; role: string; parts?: unknown };

/** What "Copy message" puts on the clipboard: the reply's text parts, tool noise excluded. */
export function messageCopyText(parts: PartLike[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The last user text before the given assistant message — the question the reply answered. */
export function questionBefore(messages: MessageLike[], messageId: string): string | undefined {
  let question: string | undefined;
  for (const m of messages) {
    if (m.id === messageId) return question;
    if (m.role !== "user" || !Array.isArray(m.parts)) continue;
    const text = messageCopyText(m.parts as PartLike[]);
    if (text) question = text;
  }
  return question;
}
