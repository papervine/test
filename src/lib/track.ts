import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { analyticsEvent } from "./db/app-schema";

export type EventType = "page_view" | "search" | "assistant" | "feedback";
export type EventSource = "human" | "agent";

export interface EventInput {
  siteId: string;
  type: EventType;
  source?: EventSource;
  /** For agent events: the detected agent name ('Claude' | 'ChatGPT' | 'Other'). */
  agent?: string | null;
  path?: string | null;
  referrer?: string | null;
  query?: string | null;
  status?: string | null;
  sessionId?: string | null;
}

/**
 * Append one analytics event (SPEC §10.1). Fire-and-forget from request handlers:
 * instrumentation must NEVER break the request it measures, so a failed insert is
 * swallowed and warned (mirrors the renderer/config "warn, don't throw" principle).
 */
export async function logEvent(e: EventInput): Promise<void> {
  try {
    await db.insert(analyticsEvent).values({
      id: randomUUID(),
      siteId: e.siteId,
      type: e.type,
      source: e.source ?? "human",
      agent: e.agent ?? null,
      path: e.path ?? null,
      referrer: e.referrer ?? null,
      query: e.query ?? null,
      status: e.status ?? null,
      sessionId: e.sessionId ?? null,
    });
  } catch (err) {
    console.warn("[analytics] failed to log event:", err);
  }
}

/** Normalize a raw Referer/referrer to a host, or '$direct' for none/same-origin. */
export function normalizeReferrer(
  raw: string | null | undefined,
  selfHost: string | null,
): string {
  if (!raw) return "$direct";
  try {
    const host = new URL(raw).host;
    if (!host || host === selfHost) return "$direct";
    return host;
  } catch {
    return "$direct";
  }
}
