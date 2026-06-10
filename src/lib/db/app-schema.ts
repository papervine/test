// DOMAIN SCHEMA — Papervine's own control-plane tables (SPEC §2, §9). Kept separate
// from the Better Auth generated schema.ts so `better-auth generate` never wipes them.
import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./schema";

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
    customDomain: text("custom_domain").unique(),
    // "Host at /docs": serve the docs under {customDomain}/docs instead of at its
    // root, so the customer can keep their own site on the apex (incumbent parity).
    customDomainSubpath: boolean("custom_domain_subpath")
      .default(false)
      .notNull(),
    // Set once a live check (GET {domain}/api/site-identity) confirms the domain
    // actually resolves to this site; null = pending DNS. Drives the dashboard badge.
    customDomainVerifiedAt: timestamp("custom_domain_verified_at"),
    // 'draft' until the first successful sync, then 'live'.
    status: text("status").default("draft").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("site_organizationId_idx").on(table.organizationId)],
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

export const deploymentRelations = relations(deployment, ({ one }) => ({
  site: one(site, { fields: [deployment.siteId], references: [site.id] }),
  actor: one(user, { fields: [deployment.actorUserId], references: [user.id] }),
}));
