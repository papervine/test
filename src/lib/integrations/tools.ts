import "server-only";
import type { ToolSet } from "ai";
import { listConnections } from "./nango";
import { findConnector } from "./catalog";
import { googleDriveTools } from "./providers/google-drive";

/**
 * The agent's tools for whatever an org has connected (SPEC §10.2).
 *
 * Composed per run, from live connection rows — which is what makes "disconnect =
 * instantly revoked" true rather than aspirational: the next run simply doesn't get the
 * tools, and nothing cached keeps working.
 *
 * A provider is wired here only when its tool set exists (`hasTools`). Connecting is
 * generic plumbing; reading is per-provider code, so the two land at different times and
 * the UI says which is which rather than implying the agent can already read a source.
 */
const TOOL_SETS: Record<string, (organizationId: string) => ToolSet> = {
  "google-drive": googleDriveTools,
};

export async function connectedTools(organizationId: string): Promise<ToolSet> {
  let connections;
  try {
    connections = await listConnections(organizationId);
  } catch (err) {
    // A connector outage must not take down a run that could still answer from the docs.
    console.warn("[integrations] could not load connections:", err);
    return {};
  }

  let tools: ToolSet = {};
  for (const connection of connections) {
    if (connection.status !== "active") continue;
    const connector = findConnector(connection.provider);
    const build = connector?.hasTools ? TOOL_SETS[connection.provider] : undefined;
    if (!build) continue;
    tools = { ...tools, ...build(organizationId) };
  }
  return tools;
}

/** Names of the connected sources with live tools — for the run's system prompt, so the
 * agent knows what it can reach instead of discovering it by calling something. */
export async function connectedSourceNames(organizationId: string): Promise<string[]> {
  try {
    const connections = await listConnections(organizationId);
    return connections
      .filter((c) => c.status === "active" && findConnector(c.provider)?.hasTools)
      .map((c) => c.provider);
  } catch {
    return [];
  }
}
