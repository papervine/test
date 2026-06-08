// DOMAIN SCHEMA — Docbot's own control-plane tables (SPEC §2, §9). Kept separate
// from the Better Auth generated schema.ts so `better-auth generate` never wipes them.
import { relations } from "drizzle-orm";
import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { organization, user } from "./schema";

// A tenant's docs site. One organization can own several. `slug` is the
// *.docbot.app subdomain; `customDomain` is the optional vanity host (docs.acme.com).
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
    filesAdded: integer("files_added").default(0).notNull(),
    filesEdited: integer("files_edited").default(0).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("deployment_siteId_idx").on(table.siteId)],
);

export const siteRelations = relations(site, ({ one, many }) => ({
  organization: one(organization, {
    fields: [site.organizationId],
    references: [organization.id],
  }),
  deployments: many(deployment),
}));

export const deploymentRelations = relations(deployment, ({ one }) => ({
  site: one(site, { fields: [deployment.siteId], references: [site.id] }),
  actor: one(user, { fields: [deployment.actorUserId], references: [user.id] }),
}));
