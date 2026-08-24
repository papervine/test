import "server-only";
import type { AssistantHooks } from "@papervine/renderer/lib/assistant-run";
import { logEvent, setEventStatus } from "@/lib/track";
import { recordAiUsage } from "@/lib/billing/store";

/**
 * The hosted half of an assistant run: question analytics and credit metering.
 *
 * The conversation itself moved to `@papervine/renderer` so the CLI can run it, and these two
 * concerns could not go with it — they need a database, an organization and a rate table. They
 * are injected instead, and defined **once, here**, for the same reason
 * `runAssistantConversation` is shared at all: there are two hosted callers (the in-docs route
 * and the cross-origin widget route), and a metering mistake must not be able to drift between
 * them.
 *
 * Both are fire-and-forget by design — a failure to log or to charge must never take down an
 * answer the reader is already receiving (billing/core.ts).
 */
export const hostedAssistantHooks: AssistantHooks = {
  logQuestion: ({ siteId, query }) =>
    logEvent({ siteId, type: "assistant", source: "human", query }),
  setOutcome: (eventId, outcome) => void setEventStatus(eventId, outcome),
  recordUsage: (input) => void recordAiUsage(input),
};
