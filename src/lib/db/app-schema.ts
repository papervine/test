// DOMAIN SCHEMA — Papervine's own control-plane tables (SPEC §2, §9). Kept separate
// from the Better Auth generated schema.ts so `better-auth generate` never wipes them.
import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./schema";
import type { ReaderAuthConfig } from "@/lib/reader-auth";

// A tenant's docs site. One organization can own several. `slug` is the
// *.papervine.io subdomain; `customDomain` is the optional vanity host (docs.example.com).
export const site = pgTable(
  "site",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // Where this site's content comes FROM — the authoring source of truth (SPEC §10.11),
    // NOT how it renders (both kinds render from sites/{id}/… through s3Source, which is
    // why this isn't called `contentSource` — that's already a renderer type).
    //   'git'    — a connected repo; syncSite copies repo → storage, publish commits/PRs.
    //   'native' — Papervine-hosted: no repo. The draft buffer is the source of truth and
    //              publish writes it straight to storage (src/lib/native-publish.ts).
    // Default 'git' so every pre-existing row keeps today's behavior with no backfill.
    // Read it through src/lib/site-source.ts, never by comparing the string inline.
    sourceKind: text("source_kind").default("git").notNull(),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch").default("main").notNull(),
    // Subdirectory the docs.json lives in (hosted docs platforms' "docs.json is in a subdirectory"
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
    // root, so the customer can keep their own site on the apex (docs platform parity).
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
    // AI assistant operational state (SPEC §8.6). These two toggles live in the DB — not
    // docs.json — precisely so they take effect *instantly* without a Git commit: the
    // enable switch is an operational kill switch, and CAPTCHA throttles abuse/token cost
    // on the public /api/assistant endpoint. Published-behavior config (starter questions,
    // deflection, search domains) is version-controlled in docs.json's `assistant` block
    // instead, edited through the authoring layer (§9.2).
    assistantEnabled: boolean("assistant_enabled").default(true).notNull(),
    assistantCaptchaEnabled: boolean("assistant_captcha_enabled")
      .default(true)
      .notNull(),
    // Embeddable assistant widget (SPEC §8.7) — a <script> a customer drops into any
    // EXTERNAL site (not just their Papervine docs), gated by origin rather than a
    // reader session. `widgetId` is public (safe in client-side code, shown in the
    // embed snippet) and immutable; `widgetEnabled` is off by default since this is a
    // new public, unauthenticated surface (unlike assistantEnabled's default-on, which
    // gates an already-trusted same-origin surface). `widgetAllowedOrigins` is the CORS
    // allowlist enforced by /api/widget/[widgetId]/chat — exact origin strings only, no
    // paths or wildcards.
    widgetId: text("widget_id").unique(),
    widgetEnabled: boolean("widget_enabled").default(false).notNull(),
    widgetAllowedOrigins: jsonb("widget_allowed_origins").$type<string[]>().default([]).notNull(),
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
    // What kicked off the sync — 'connect' | 'manual' | 'webhook' (SyncTrigger in
    // src/lib/sync-runner.ts). Drives the feed's label ("GitHub push" vs "Manual
    // re-sync"); null on rows that predate the column.
    trigger: text("trigger"),
    // Wall-time of the sync, stamped when the row resolves. null while 'building' (and
    // on pre-column rows) — a resolved row without it reads as "—" in the feed detail.
    durationMs: integer("duration_ms"),
    filesAdded: integer("files_added").default(0).notNull(),
    filesEdited: integer("files_edited").default(0).notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("deployment_siteId_idx").on(table.siteId)],
);

// AUTHORING (SPEC §9.2 / §10) — the shared backend for the web editor and the authoring
// MCP. An edit session is a working branch off the deploy branch; its draft files are a
// server-side buffer that only reaches git on publish (commit or PR). Both the human
// editor and the editing agent write the SAME draftFile rows, so there's one source of
// truth and no divergence. Drafts live in Postgres (not S3, which holds immutable synced
// content): they're small, mutable, need transactional dirty-state + cascade cleanup.
export const editorSession = pgTable(
  "editor_session",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // The working branch these drafts target, e.g. "papervine/edit-ab12c3d4". Created
    // remotely lazily (at publish), so a session can exist before the git branch does.
    branch: text("branch").notNull(),
    // The deploy branch this forked from (site.branch at checkout) — the PR base / commit
    // target on publish.
    baseBranch: text("base_branch").notNull(),
    // Head of baseBranch at checkout. Publish compares it to the live head to detect the
    // deploy branch moving under us (optimistic concurrency); updateRef(force:false) is
    // the hard guard.
    baseCommitSha: text("base_commit_sha"),
    // 'open' | 'published' | 'discarded'
    status: text("status").default("open").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One OPEN session per (site, branch) — the editor + agent attach to the same one. Partial
    // (status='open' only): closeSession never deletes a row (discard/publish are soft status
    // flips), so a full-table unique index here would permanently block ever checking out that
    // branch again after its first publish or discard — every later save 500s on a duplicate
    // key forever. Scoping to 'open' lets closed rows pile up (each is a real historical
    // session) while still preventing two concurrently-open sessions for the same branch.
    uniqueIndex("editorSession_site_branch_idx")
      .on(table.siteId, table.branch)
      .where(sql`${table.status} = 'open'`),
  ],
);

// A single buffered file in an edit session: the full MDX (or docs.json) text, keyed by
// repo-relative path. `deleted` tombstones a page removed in the session so the overlay
// hides it from the live S3 content until publish carries the delete to git.
export const draftFile = pgTable(
  "draft_file",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => editorSession.id, { onDelete: "cascade" }),
    // Repo-relative docs path, e.g. "guides/intro.mdx" or "docs.json".
    path: text("path").notNull(),
    // Full buffered text (MDX/JSON). Postgres text handles MB-scale docs fine.
    content: text("content").notNull(),
    // An uploaded asset: the bytes are NOT here — a video doesn't belong in a text column — they
    // live in object storage at `drafts/{sessionId}/{path}` (see src/lib/media-upload.ts) and
    // `content` is empty. The row still exists so the change list, per-file revert and
    // discard-all keep working without caring that some changes are bytes rather than text.
    binary: boolean("binary").default(false).notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Upsert-on-save key: one row per path per session.
    uniqueIndex("draftFile_session_path_idx").on(table.sessionId, table.path),
  ],
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

// Exit-survey row captured when an owner deletes a site or org from the Danger zone
// (SPEC §10.5). Deliberately NOT FK'd to site/organization: the whole point is to
// outlive the thing being deleted (those rows are gone the moment the deletion commits),
// so we snapshot the subject's name + id as plain text. Append-only; nothing reads it in
// the app yet — it's product/retention feedback, the way Vercel/hosted docs platforms ask "why are
// you deleting this?". actorUserId stays (the user isn't deleted) but is set null if they
// later are, so the survey survives independently.
export const deletionFeedback = pgTable(
  "deletion_feedback",
  {
    id: text("id").primaryKey(),
    // 'site' | 'organization' (DangerScope in src/lib/danger-zone.ts).
    scope: text("scope").notNull(),
    // The deleted thing's id + display name, snapshotted (no FK — the row is gone).
    subjectId: text("subject_id").notNull(),
    subjectName: text("subject_name").notNull(),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("deletionFeedback_createdAt_idx").on(table.createdAt)],
);

// Durable "always delete a domain when asked" (SPEC §2 reconciler). Freeing a host — changing
// a site's domain, removing it, or deleting the site — enqueues the host here AND attempts the
// Vercel detach inline; on success the row is deleted immediately, but if that one call fails
// (API down, timeout) the row survives and the reconcile cron drains it, retrying until Vercel
// confirms the detach (or 404s). So a transient failure can never orphan a host on the project.
// Keyed by the host so duplicate requests collapse (ON CONFLICT DO NOTHING).
export const domainRemoval = pgTable(
  "domain_removal",
  {
    domain: text("domain").primaryKey(),
    attempts: integer("attempts").default(0).notNull(),
    lastAttemptAt: timestamp("last_attempt_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("domainRemoval_createdAt_idx").on(table.createdAt)],
);

// ============================== BILLING (SPEC §10 "Billing") ==============================
// Design rules (see _private/pricing-plan.md for the strategy; SPEC gets the sanitized
// architecture note):
//   1. CATALOG IS DATA — plans/prices/rates are DB rows seeded from src/lib/billing/
//      catalog.json (`npm run billing:sync`), never constants in product code, so
//      repricing is a config edit + publish, not a deploy.
//   2. APPEND-ONLY WHERE MONEY LIVES — plan versions are immutable snapshots
//      (subscriptions pin the version they bought → grandfathering is free); prices are
//      archived, never mutated (mirrors Stripe's own immutable Prices); the credit
//      ledger is the source of truth and is never updated or deleted.
//   3. STRIPE IS THE BILLING AUTHORITY, THE DB IS THE MIRROR — webhooks (recorded in
//      stripe_event for idempotency) are the only mutation path into subscription state.

// A sellable plan. Stable key ('free' | 'team' | 'pro' | 'enterprise' | 'trial') — the
// key is the identity everything else hangs off; display fields live on the version.
// `listed` = shown on /pricing and purchasable ('trial' is a lifecycle state, not a SKU).
export const billingPlan = pgTable("billing_plan", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  blurb: text("blurb").default("").notNull(),
  listed: boolean("listed").default(true).notNull(),
  sort: integer("sort").default(0).notNull(),
  // Stripe Product id, set when the catalog is published to Stripe (Phase 3). Test vs
  // live mode is per-environment: each environment's DB carries its own mode's ids.
  stripeProductId: text("stripe_product_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// An immutable snapshot of what a plan grants. Changing entitlements/credits in the
// catalog mints a NEW version row (configHash detects drift); existing subscriptions
// keep the version they're pinned to until deliberately migrated. Never UPDATE a
// published version's grants — that would silently reprice live customers.
export const billingPlanVersion = pgTable(
  "billing_plan_version",
  {
    id: text("id").primaryKey(),
    planKey: text("plan_key")
      .notNull()
      .references(() => billingPlan.key, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // PlanEntitlements (src/lib/billing/catalog.ts): sites/editors/retention + feature
    // flags. jsonb so adding a gate is a catalog edit + new version, not a migration.
    entitlements: jsonb("entitlements").notNull(),
    includedMonthlyCredits: integer("included_monthly_credits").default(0).notNull(),
    // Retail overage in cents per 1,000 credits (800 = $0.008/credit); null = no
    // overage offered on this plan.
    overageCentsPerThousandCredits: integer("overage_cents_per_thousand_credits"),
    // Hash of the version-relevant catalog fields — billing:sync compares this to skip
    // no-op publishes.
    configHash: text("config_hash").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("billingPlanVersion_plan_version_idx").on(table.planKey, table.version),
  ],
);

// Purchasable price points, append-only mirror of Stripe Prices (which are themselves
// immutable): a price change adds a row and archives the old one (active=false — safe,
// existing Stripe subscriptions keep billing on the archived price until migrated).
// Attached to the PLAN, not the version: entitlement tweaks shouldn't force new Stripe
// prices. For interval 'year', unitAmountCents is the per-year charge.
export const billingPrice = pgTable(
  "billing_price",
  {
    id: text("id").primaryKey(),
    planKey: text("plan_key")
      .notNull()
      .references(() => billingPlan.key, { onDelete: "cascade" }),
    interval: text("interval").notNull(), // 'month' | 'year'
    unitAmountCents: integer("unit_amount_cents").notNull(),
    currency: text("currency").default("usd").notNull(),
    stripePriceId: text("stripe_price_id").unique(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("billingPrice_planKey_idx").on(table.planKey)],
);

// One-time credit top-ups (Team+). Same append-only discipline as billing_price.
export const creditPack = pgTable("credit_pack", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  credits: integer("credits").notNull(),
  priceCents: integer("price_cents").notNull(),
  stripePriceId: text("stripe_price_id").unique(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// org <-> Stripe Customer. Separate from billing_subscription because the customer
// outlives any subscription (canceled orgs keep their Stripe history/invoices).
export const billingCustomer = pgTable("billing_customer", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// An org's current billing state — exactly one row per org (created at signup with the
// trial plan version). Orgs with NO row resolve to Free entitlements (billing/core.ts):
// legacy orgs and DB-free render paths must never throw or gate harder than Free.
export const billingSubscription = pgTable(
  "billing_subscription",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The pinned immutable grant snapshot (rule 2 above).
    planVersionId: text("plan_version_id")
      .notNull()
      .references(() => billingPlanVersion.id),
    // 'trialing' | 'active' | 'past_due' | 'canceled'. past_due keeps entitlements
    // (Stripe dunning is retrying the card, not a cutoff decision); canceled/expired
    // trial resolve to Free.
    status: text("status").default("trialing").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    trialEndsAt: timestamp("trial_ends_at"),
    // Org-level opt-in to metered overage past the included credits. Default OFF: hard
    // caps, no surprise bills (_private/pricing-plan.md).
    overageEnabled: boolean("overage_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("billingSubscription_status_idx").on(table.status)],
);

// Every received Stripe webhook, keyed by Stripe's event id — INSERT ... ON CONFLICT DO
// NOTHING makes redeliveries no-ops (processing must be idempotent), and the payload is
// the audit trail when a mirror row looks wrong.
export const stripeEvent = pgTable(
  "stripe_event",
  {
    id: text("id").primaryKey(), // Stripe evt_… id
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    error: text("error"),
  },
  (table) => [index("stripeEvent_type_idx").on(table.type)],
);

// An automation configured on a site (SPEC §10.2): a per-site instance of a catalog
// automation (catalog_key names the preset in src/lib/automations/catalog.ts) or a
// custom one (catalog_key 'custom' + a user-given name). This is the *intent* half of
// the executor-as-projection design — the executor (Trigger.dev) only ever reflects
// what these rows say, so the executor stays swappable (SPEC §18).
export const automation = pgTable(
  "automation",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    catalogKey: text("catalog_key").notNull(),
    // Custom automations only; predefined ones take the catalog title.
    name: text("name"),
    enabled: boolean("enabled").default(false).notNull(),
    // 'content_update' | 'cron' | 'code_change' (AutomationTriggerType)
    triggerType: text("trigger_type").notNull(),
    // cron trigger only: raw 5-field cron expression, UTC.
    cronExpression: text("cron_expression"),
    // The executor's schedule handle for the registered cron — null until registered.
    // Stored so a config change or disable can find and deregister the old schedule
    // instead of leaking it (same reconcile-against-reality posture as domains, §2).
    executorScheduleId: text("executor_schedule_id"),
    // code_change trigger only: "owner/repo" whose merged PRs / base-branch pushes fire
    // this. Distinct from contextRepos: these *trigger*, those are read-only context.
    triggerRepos: jsonb("trigger_repos").$type<string[]>(),
    // Read-only repos cloned into the run environment for context. Never trigger.
    contextRepos: jsonb("context_repos").$type<string[]>(),
    // 'auto' = commit directly through the authoring backend; 'review' = open a PR.
    applyMode: text("apply_mode").default("review").notNull(),
    // Appended to the catalog basePrompt on every run (custom: this IS the prompt).
    additionalPrompt: text("additional_prompt"),
    // Per-automation extras; shape owned by the catalog entry (translate locales, …).
    extras: jsonb("extras"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("automation_siteId_idx").on(table.siteId),
    // One instance of each predefined automation per site; customs repeat freely.
    uniqueIndex("automation_site_catalog_uidx")
      .on(table.siteId, table.catalogKey)
      .where(sql`${table.catalogKey} != 'custom'`),
  ],
);

// One row per automation run — the run history behind the Automations tab, and the
// durable record the executor projection converges on. Every run's AI spend lands in
// usage_event rows correlated by requestId = this id; creditsUsed denormalizes their
// sum for cheap history rendering.
export const automationRun = pgTable(
  "automation_run",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    // Denormalized: the run history is a per-site view and must survive an automation
    // being reconfigured mid-history.
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // What fired it: 'content_update' | 'cron' | 'code_change' | 'manual' (run-now).
    triggerType: text("trigger_type").notNull(),
    // The firing event: commit sha (content_update), PR/push ref (code_change), or the
    // triggering user id (manual). Debuggability + idempotency (skip an already-run ref).
    triggerRef: text("trigger_ref"),
    // 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
    // | 'review_needed' (applyMode "review": draft left open for in-app review)
    // | 'rejected' (a review_needed run the operator discarded).
    status: text("status").default("queued").notNull(),
    // The executor's run handle (Trigger.dev run_… id) — correlation for logs/replays.
    executorRunId: text("executor_run_id"),
    // The site's head commit at enqueue time — what this run's docs looked like. Lets
    // the next trigger skip entirely when nothing has changed since the last success
    // (SPEC §10.2 cost guardrails).
    sourceSha: text("source_sha"),
    // code_change runs only: the triggering push the task can't otherwise reconstruct
    // from runId → row. `{ repo, sha, changedFiles }` — feeds the run prompt (what
    // changed) and scopes the trigger-repo read tool to the right ref (SPEC §10.2).
    triggerContext: jsonb("trigger_context").$type<{
      repo: string;
      sha: string;
      changedFiles: string[];
    }>(),
    // What the run produced through the authoring backend: a commit sha or PR URL;
    // null = the run decided no changes were needed (a valid success).
    resultRef: text("result_ref"),
    // status 'review_needed' only: the still-open editor_session branch holding the buffered
    // draft, so the run row's "View changes" can deep-link the editor to it and Accept can
    // publish it. Null once accepted/rejected (SPEC §10.2 in-app review).
    reviewBranch: text("review_branch"),
    // Agent-authored one-paragraph summary of what it did (shown in run history).
    summary: text("summary"),
    // The exact instructions this run's agent received (buildRunPrompt output at
    // execution time) — the config may be edited later, so the row keeps its own copy
    // for the run-detail view.
    prompt: text("prompt"),
    // Docs-root-relative paths of the files the run drafted (recorded whether or not
    // the publish succeeded). Empty array = a "no changes" run.
    changedFiles: jsonb("changed_files").$type<string[]>(),
    error: text("error"),
    creditsUsed: integer("credits_used").default(0).notNull(),
    queuedAt: timestamp("queued_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    index("automationRun_site_queuedAt_idx").on(table.siteId, table.queuedAt),
    index("automationRun_automation_queuedAt_idx").on(table.automationId, table.queuedAt),
  ],
);

// Versioned token->credit rate tables (CreditRateTable in billing/catalog.ts). Append-
// only: model economics change => publish a new version; historical usage_event rows
// keep the rateVersion they were billed under, so past charges stay explainable.
export const creditRateVersion = pgTable("credit_rate_version", {
  id: text("id").primaryKey(),
  version: integer("version").notNull().unique(),
  rates: jsonb("rates").notNull(),
  effectiveAt: timestamp("effective_at").defaultNow().notNull(),
  notes: text("notes"),
});

// The token-level meter: one row per AI operation (assistant answer, writer run,
// workflow run), rated to credits at write time. This is the drill-down behind the
// billing page's usage view and the input for rate-table calibration.
export const usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    siteId: text("site_id").references(() => site.id, { onDelete: "set null" }),
    // 'assistant' | 'writer' | 'workflow' — buyer-facing operation, not model detail.
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").default(0).notNull(),
    tokensOut: integer("tokens_out").default(0).notNull(),
    credits: integer("credits").notNull(),
    rateVersion: integer("rate_version").notNull(),
    // Correlates with request logs / the assistant's own analytics event.
    requestId: text("request_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usageEvent_org_createdAt_idx").on(table.organizationId, table.createdAt),
  ],
);

// THE credit source of truth — append-only double-entry-ish ledger. Balances are derived
// (credit_balance is just a cache); support disputes and accounting reconcile from here.
// Never UPDATE or DELETE a ledger row; corrections are compensating 'adjustment' entries
// with an actor + reason.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Positive = grant, negative = burn. Always credits, never money.
    delta: integer("delta").notNull(),
    // 'grant_trial' | 'grant_monthly' | 'grant_pack' | 'usage' | 'adjustment' | 'expiry'
    kind: text("kind").notNull(),
    // Which bucket this touches: 'trial' | 'monthly' | 'pack'. Consumption order is
    // trial -> monthly -> pack (billing/core.ts planDebits).
    bucket: text("bucket").notNull(),
    // Backrefs: the usage event that burned credits, the Stripe object that paid for a
    // grant, the staff member (+ mandatory reason) behind an adjustment.
    usageEventId: text("usage_event_id").references(() => usageEvent.id, {
      onDelete: "set null",
    }),
    stripeRef: text("stripe_ref"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    reason: text("reason"),
    // Grants only: when this bucket's remainder evaporates (trial end / period end).
    expiresAt: timestamp("expires_at"),
    // Monthly grants: the UTC period ("2026-07") they belong to — renewal expires
    // exactly one period and re-runs can't double-grant (unique below).
    periodKey: text("period_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("creditLedger_org_createdAt_idx").on(table.organizationId, table.createdAt),
    // One monthly grant per org per period, DB-enforced (partial: other kinds repeat).
    uniqueIndex("creditLedger_monthly_grant_uidx")
      .on(table.organizationId, table.kind, table.periodKey)
      .where(sql`${table.kind} = 'grant_monthly'`),
  ],
);

// Hot-path balance cache (checked on every AI call), rebuilt from the ledger — on any
// disagreement the ledger wins. Split by bucket so planDebits can run off one read.
export const creditBalance = pgTable("credit_balance", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  trialCredits: integer("trial_credits").default(0).notNull(),
  monthlyCredits: integer("monthly_credits").default(0).notNull(),
  packCredits: integer("pack_credits").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const billingPlanRelations = relations(billingPlan, ({ many }) => ({
  versions: many(billingPlanVersion),
  prices: many(billingPrice),
}));

export const billingPlanVersionRelations = relations(billingPlanVersion, ({ one }) => ({
  plan: one(billingPlan, {
    fields: [billingPlanVersion.planKey],
    references: [billingPlan.key],
  }),
}));

export const billingPriceRelations = relations(billingPrice, ({ one }) => ({
  plan: one(billingPlan, {
    fields: [billingPrice.planKey],
    references: [billingPlan.key],
  }),
}));

export const billingSubscriptionRelations = relations(billingSubscription, ({ one }) => ({
  organization: one(organization, {
    fields: [billingSubscription.organizationId],
    references: [organization.id],
  }),
  planVersion: one(billingPlanVersion, {
    fields: [billingSubscription.planVersionId],
    references: [billingPlanVersion.id],
  }),
}));

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
  organization: one(organization, {
    fields: [usageEvent.organizationId],
    references: [organization.id],
  }),
  site: one(site, { fields: [usageEvent.siteId], references: [site.id] }),
}));

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  organization: one(organization, {
    fields: [creditLedger.organizationId],
    references: [organization.id],
  }),
  usageEvent: one(usageEvent, {
    fields: [creditLedger.usageEventId],
    references: [usageEvent.id],
  }),
}));

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

export const editorSessionRelations = relations(editorSession, ({ one, many }) => ({
  site: one(site, { fields: [editorSession.siteId], references: [site.id] }),
  createdByUser: one(user, { fields: [editorSession.createdBy], references: [user.id] }),
  drafts: many(draftFile),
}));

export const draftFileRelations = relations(draftFile, ({ one }) => ({
  session: one(editorSession, {
    fields: [draftFile.sessionId],
    references: [editorSession.id],
  }),
}));

// One fixed-window counter per (surface, hashed client) — the store behind
// src/lib/rate-limit.ts, which guards the two PUBLIC AI endpoints (/api/assistant and
// /api/widget/{id}/chat) against a single visitor burning the model budget.
//
// Deliberately FK-free and org-free: the key is `{surface}:{sha256(ip)}`, so a row can't
// be traced back to a reader, and there is nothing to cascade from. That also means
// seed-dev's wipeDb() truncates it harmlessly, and rows are disposable — losing the table
// costs at most one window of allowance, never data.
// Pre-launch waitlist signups from the marketing home (SPEC §2). No FK to `user` or
// `organization` on purpose: the whole point is that these people have no account yet, and a
// nullable FK to a row that will never exist buys nothing. Read in the operator console.
export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    id: text("id").primaryKey(),
    // Stored lowercased/trimmed by normalizeEmail(), which is what makes the unique index mean
    // "one person" rather than "one spelling".
    email: text("email").notNull(),
    // What they said they were looking for — optional, and their words rather than a bucket we
    // guessed. Bounded at WAITLIST_NOTE_MAX before it gets here.
    note: text("note"),
    // The page they submitted from, captured rather than typed.
    source: text("source"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("waitlistEntry_email_uidx").on(table.email)],
);

export const rateLimit = pgTable("rate_limit", {
  // `{surface}:{hashed ip}` — see rateLimitKey(). Never contains a raw IP.
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start").notNull(),
});
