/**
 * The connectors an org can attach to the agent (SPEC §10.2 — "integrations connection
 * store + tool layer").
 *
 * PURE — no DB, no network, no `server-only` — so the rules unit-test in isolation and
 * the client can import the display half. This is the **allowlist**: a provider that
 * isn't here cannot be connected, which is what stops a crafted request from opening a
 * connect session against an arbitrary Nango integration on our account.
 *
 * `providerConfigKey` is the integration id as configured in the Nango dashboard. It is
 * deliberately separate from our own `id` (which the gallery already uses and which
 * appears in URLs): they happen to match today, and coupling them would make renaming an
 * integration in Nango a breaking change here.
 */

export type ConnectorProvider = {
  /** Our id — matches the gallery catalog entry in components/app/automate/integrations. */
  id: string;
  /** The integration id configured in Nango. */
  providerConfigKey: string;
  /** Shown on the connected row: what the agent can actually do with it. */
  capability: string;
  /**
   * Whether the agent gets tools from this connection yet. A provider can be connectable
   * before its tools exist (the OAuth plumbing is generic; each tool set is hand-written
   * against that provider's API), and the UI says so rather than implying the agent can
   * already read it.
   */
  hasTools: boolean;
};

export const CONNECTORS: ConnectorProvider[] = [
  {
    id: "google-drive",
    providerConfigKey: "google-drive",
    capability: "Search files and read documents the connected account can open.",
    hasTools: true,
  },
  {
    id: "jira",
    providerConfigKey: "jira",
    capability: "Search issues with JQL and read one with its comment thread.",
    hasTools: true,
  },
  {
    id: "notion",
    providerConfigKey: "notion",
    // Worth being precise: Notion only exposes what the integration was explicitly
    // shared with, which is a narrower grant than "the workspace" and the usual reason
    // a search comes back empty.
    capability: "Search and read the Notion pages shared with the connected integration.",
    hasTools: true,
  },
];

export function findConnector(id: string): ConnectorProvider | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** Reverse lookup for the webhook, which knows Nango's key rather than ours. */
export function connectorByProviderConfigKey(key: string): ConnectorProvider | undefined {
  return CONNECTORS.find((c) => c.providerConfigKey === key);
}

/** Is this a provider we're willing to open a connect session for? */
export function isConnectableProvider(id: string): boolean {
  return !!findConnector(id);
}
