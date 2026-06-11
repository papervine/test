// DOMAIN SCHEMA — Papervine's own control-plane tables (SPEC §2, §9). Kept separate
// from the Better Auth generated schema.ts so `better-auth generate` never wipes them.
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./schema";
import type { ReaderAuthConfig } from "@/lib/reader-auth";

// A tenant's docs site. One organization can own several. `slug` is the
// *.papervine.io subdomain; `customDomain` is the optional vanity host (docs.acme.com).
export const site = pgTable(
  "site",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch").default("main").notNull(),
    // Subdirectory the docs.json lives in (the incumbent's "docs.json is in a subdirectory"
    // option), normalized by normalizeDocsPath. "" = repo root. Sync strips this prefix
    // so storage keys stay sites/{id}/docs.json regardless — the render path never sees it.
    docsPath: text("docs_path").default("").notNull(),
    // Private repos: the repo isn't reachable unauthenticated, so sync must present a
    // token. `repoTokenEnc` holds an AES-256-GCM-encrypted GitHub token (a fine-grained
    // PAT today; a GitHub App installation token later — same seam, see src/lib/sync.ts).
    // Never store the token in plaintext; encrypt via src/lib/crypto.ts.
    isPrivate: boolean("is_private").default(false).notNull(),
    repoTokenEnc: text("repo_token_enc"),
    customDomain: text("custom_domain").unique(),
    // "Host at /docs": serve the docs under {customDomain}/docs instead of at its
    // root, so the customer can keep their own site on the apex (incumbent parity).
    customDomainSubpath: boolean("custom_domain_subpath")
      .default(false)
      .notNull(),
    // Set once a live check (GET {domain}/api/site-identity) confirms the domain
    // actually resolves to this site; null = pending DNS. Drives the dashboard badge.
    customDomainVerifiedAt: timestamp("custom_domain_verified_at"),
    // Layer 2 reader-auth (SPEC §11.2): gate published docs behind the customer's own
    // login. We never run an IdP for readers — we verify a signed assertion and mint a
    // short docs session. These columns are the dashboard-managed config; enforcement
    // (the JWT/OAuth/password handshake in middleware) is the v2 follow-up.
    authEnabled: boolean("auth_enabled").default(false).notNull(),
    // null until a method is chosen. 'jwt' | 'oauth' | 'password' (build order, §11.2).
    authMethod: text("auth_method"),
    // Non-secret per-method config (login URL, OAuth endpoints, client id, scopes).
    // Secrets never live here — see authSecretEnc.
    authConfig: jsonb("auth_config").$type<ReaderAuthConfig>(),
    // The method's one secret — the JWT signing secret, the OAuth client secret, or the
    // shared password — AES-256-GCM-encrypted at rest (src/lib/crypto.ts), same as
    // repoTokenEnc. Decrypted only to display to the site's own owner.
    authSecretEnc: text("auth_secret_enc"),
    // GitHub App installation that grants access to this repo (SPEC §3). The numeric
    // GitHub installation id — minted into a short-lived token at sync time (see
    // src/lib/github-app.ts), the same `token` seam as repoTokenEnc/PAT. Not a FK so an
    // uninstall (which nulls this in the webhook handler) never cascades the site away;
    // a re-link restores it. null → connected by PAT or public, not by the App.
    githubInstallationId: integer("github_installation_id"),
    // Head commit sha of the last successful sync. Lets the push webhook skip a delivery
    // whose head we've already synced (idempotency for redeliveries / rapid pushes).
    lastSyncedCommitSha: text("last_synced_commit_sha"),
    // 'draft' until the first successful sync, then 'live'.
    status: text("status").default("draft").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("site_organizationId_idx").on(table.organizationId),
    // The push webhook fans out by repo → all sites on that repo, so it queries by
    // (repo_owner, repo_name). Index it so a busy install doesn't table-scan `site`.
    index("site_repo_idx").on(table.repoOwner, table.repoName),
  ],
);

// A GitHub App installation (SPEC §3). One install on a user/org account grants access
// to many repos, so it's its own table keyed by the org that installed it — sites then
// carry the numeric installation id (site.githubInstallationId) to mint sync tokens.
// Created/updated by the App setup callback and the `installation` webhook event;
// removed on uninstall (which also nulls the dependent sites' githubInstallationId).
export const githubInstallation = pgTable(
  "github_installation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // GitHub's numeric installation id — the value the webhook payload carries and the
    // token-mint endpoint takes (POST /app/installations/{id}/access_tokens). Unique:
    // one row per real installation.
    installationId: integer("installation_id").notNull().unique(),
    // The account (user or org login) the App was installed on, e.g. "acme". Shown in
    // the connect UI so the owner can tell which install backs which repo.
    accountLogin: text("account_login").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("githubInstallation_organizationId_idx").on(table.organizationId)],
);

// One row per git-sync / publish — backs the dashboard "Activity" feed.
export const deployment = pgTable(
  "deployment",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // 'building' | 'successful' | 'failed'
    status: text("status").default("building").notNull(),
    // 'live' | 'preview' — the feed's Live/Previews tabs.
    target: text("target").default("live").notNull(),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    // On a failed sync, the captured failure (message + trimmed stack). Without
    // it the *why* is lost to serverless logs the user can't reach — see the
    // dashboard Activity feed, which surfaces this on failed rows.
    error: text("error"),
    filesAdded: integer("files_added").default(0).notNull(),
    filesEdited: integer("files_edited").default(0).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("deployment_siteId_idx").on(table.siteId)],
);

// One row per tracked interaction — the first-party events table backing the
// Analytics page (SPEC §10.1). Deliberately denormalized/append-only: every source
// (page views, search, assistant) writes the same shape, aggregation reads it.
// `source` splits the Humans vs Agents toggle (browser beacon = human; MCP/raw
// markdown = agent, §9.1). Nullable columns are per-`type`: page_view fills
// path+referrer+sessionId; search/assistant fill query; feedback fills status.
export const analyticsEvent = pgTable(
  "analytics_event",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // 'page_view' | 'search' | 'assistant' | 'feedback'
    type: text("type").notNull(),
    // 'human' | 'agent'
    source: text("source").default("human").notNull(),
    // For source='agent', the friendly agent name ('Claude' | 'ChatGPT' | 'Other',
    // from UA detection — src/lib/ua-detect.ts). Backs the Agents tab "Top agents"
    // breakdown. null for human events.
    agent: text("agent"),
    // page_view: the docs path ('/guides/intro'). null for other types.
    path: text("path"),
    // page_view: referring host, or '$direct'. null for other types.
    referrer: text("referrer"),
    // search: the query; assistant: the question. null for page_view/feedback.
    query: text("query"),
    // assistant: 'answered' | 'deflected' | 'unanswered'; feedback: 'up' | 'down'.
    status: text("status"),
    // Coarse visitor identity for distinct-visitor counts (a per-browser id, not a
    // login). Same id across a session's page views; null for server-only events.
    sessionId: text("session_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("analyticsEvent_site_createdAt_idx").on(
      table.siteId,
      table.createdAt,
    ),
    index("analyticsEvent_site_type_idx").on(table.siteId, table.type),
  ],
);

export const siteRelations = relations(site, ({ one, many }) => ({
  organization: one(organization, {
    fields: [site.organizationId],
    references: [organization.id],
  }),
  deployments: many(deployment),
  events: many(analyticsEvent),
}));

export const analyticsEventRelations = relations(analyticsEvent, ({ one }) => ({
  site: one(site, { fields: [analyticsEvent.siteId], references: [site.id] }),
}));

export const githubInstallationRelations = relations(githubInstallation, ({ one }) => ({
  organization: one(organization, {
    fields: [githubInstallation.organizationId],
    references: [organization.id],
  }),
}));

export const deploymentRelations = relations(deployment, ({ one }) => ({
  site: one(site, { fields: [deployment.siteId], references: [site.id] }),
  actor: one(user, { fields: [deployment.actorUserId], references: [user.id] }),
}));
