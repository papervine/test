// Stable visitor identity for an agent request (MCP tools + /llms.txt), SPEC §10.1.
// Pure and dependency-light (just node:crypto) so it runs in route handlers AND
// unit-tests in isolation, like ua-detect.ts.
//
// "Agent Visitors" counts distinct agent *clients*, mirroring the Humans tab's
// distinct-visitor metric (which keys off a persisted localStorage UUID). The catch:
// the MCP server is stateless (no Redis) — every tool call re-instantiates the handler,
// so a per-request randomUUID() counted each read_page as a *new* visitor (3 reads in
// one Claude session showed as "3 Agent Visitors", the agent-side equivalent of putting
// the Views number in the Visitors card). This derives a stable id instead, so a single
// client's burst of calls collapses to one visitor. We don't surface an "Agent Views"
// card — hosted docs platforms' Agents tab doesn't either; per-page volume lives in Top pages.

import { createHash } from "node:crypto";

/**
 * Derive a stable per-client session id for an agent request. Priority:
 *  1. A real MCP session id (`Mcp-Session-Id`) when the client supplies one — the exact
 *     per-connection identity, and future-proof if we ever make the server stateful.
 *  2. A fingerprint of the client (agent + User-Agent + IP). No randomness and no time
 *     component, so it's stable across the whole window like the human visitor UUID:
 *     distinct clients stay distinct, one client's repeated calls dedupe to one visitor.
 *     In prod the IP differentiates separate crawlers; locally (no XFF) one agent reads
 *     as one visitor, which is the correct answer for a single client driving the tools.
 */
export function agentSessionId(opts: {
  mcpSessionId?: string | null;
  agent: string;
  userAgent?: string | null;
  ip?: string | null;
}): string {
  const explicit = opts.mcpSessionId?.trim();
  if (explicit) return explicit;
  const fingerprint = `${opts.agent}\n${opts.userAgent?.trim() ?? ""}\n${opts.ip?.trim() ?? ""}`;
  return "agent_" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);
}

/** First hop (the originating client) of an `X-Forwarded-For` header, or null. */
export function firstForwardedIp(xff: string | null | undefined): string | null {
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}
