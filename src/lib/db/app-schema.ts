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
    // --- generated skill.md (SPEC §9.1) ---------------------------------------------------
    // Set when the site publishes, cleared when generation runs. The cheap half of the
    // staleness rule: it narrows the sweep to sites that actually shipped something, and the
    // fingerprint below then decides whether that shipment changed anything worth a model call.
    skillStaleAt: timestamp("skill_stale_at"),
    // capabilityFingerprint() at the last generation. Null = never generated, which is the one
    // case that generates immediately instead of waiting for a sweep.
    skillFingerprint: text("skill_fingerprint"),
    skillGeneratedAt: timestamp("skill_generated_at"),
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
    // The immutable content revision this site currently SERVES (SPEC §10.11) — the
    // `revs/{site}/{revision}/` prefix every read path resolves through, and the whole of
    // instant rollback: pointing this at an older revision IS the rollback, which is why the
    // write lives in `markSiteLive`'s single UPDATE (atomic — no reader sees a torn tree).
    //
    // NULL means "this site still serves the LEGACY flat `sites/{id}/` prefix". That's the
    // entire backfill story: pre-revision sites keep serving exactly as before and adopt a
    // revision on their next deploy, so the migration copies nothing and takes nothing down.
    // Resolve it through src/lib/revisions.ts, never by building the prefix inline.
    liveRevisionId: text("live_revision_id"),
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

// A Slack workspace install (SPEC §10.2 — the Agent's transport). One row per Slack
// workspace, keyed by the org that installed it, exactly the githubInstallation shape:
// created/refreshed by the OAuth callback (upsert on the unique team id, since an admin
// can reinstall or move a workspace between orgs), deleted on disconnect. First-party on
// purpose — the bot token is OUR Slack app's credential for that workspace, so it lives
// encrypted here (crypto.ts), not in the Nango vault that backs the attach-services
// catalog: inbound events need our endpoint + signing secret anyway, and the transport
// every org connects shouldn't ride a metered third party.
export const slackWorkspace = pgTable(
  "slack_workspace",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Slack's team id (T…) — what event payloads carry, so the events endpoint resolves
    // workspace → org through this. Unique: one row per real workspace.
    teamId: text("team_id").notNull().unique(),
    // Workspace display name, shown in the connect banner so the owner can tell which
    // workspace is wired ("Connected to Acme Inc").
    teamName: text("team_name").notNull(),
    // The bot's own user id (U…) — needed to ignore the bot's own messages in events.
    botUserId: text("bot_user_id").notNull(),
    // xoxb bot token, AES-256-GCM via src/lib/crypto.ts (same seam as repoTokenEnc).
    botTokenEnc: text("bot_token_enc").notNull(),
    // Comma-separated granted bot scopes, as oauth.v2.access reports them — lets us
    // detect an install that predates a scope the code now needs and prompt a reinstall.
    scopes: text("scopes").notNull(),
    installedByUserId: text("installed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("slackWorkspace_organizationId_idx").on(table.organizationId)],
);

// One row per Slack agent conversation turn (SPEC §10.2) — the interactive sibling of
// `automation_run`. The row IS the idempotency record: `slack_event_id` is unique, so a
// Slack retry (it redelivers on any non-2xx, and our ack races the enqueue) can't run
// the agent twice on our credits. Site-scoped like automation_run so the history is a
// per-site view, and org-scoped for the billing gate.
export const agentRun = pgTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // 'slack' today. Named so a future transport (Teams, a web console — the §10.2 open
    // question) is a new value here rather than a second table.
    transport: text("transport").default("slack").notNull(),
    // Slack's per-delivery event id — the dedupe key (see above).
    slackEventId: text("slack_event_id").notNull().unique(),
    slackTeamId: text("slack_team_id").notNull(),
    slackChannelId: text("slack_channel_id").notNull(),
    // The thread the answer is posted into, and the message we post-then-edit while the
    // agent works ('Thinking…' → the answer). Null until the task posts its placeholder.
    slackThreadTs: text("slack_thread_ts").notNull(),
    slackMessageTs: text("slack_message_ts"),
    // Who asked (Slack user id) — attribution in the run history; not a Papervine user.
    slackUserId: text("slack_user_id").notNull(),
    // 'queued' | 'running' | 'succeeded' | 'failed'
    status: text("status").default("queued").notNull(),
    executorRunId: text("executor_run_id"),
    // The question as the agent received it (bot mention stripped).
    prompt: text("prompt").notNull(),
    // What the agent replied, as posted to Slack.
    answer: text("answer"),
    error: text("error"),
    creditsUsed: integer("credits_used").default(0).notNull(),
    queuedAt: timestamp("queued_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("agentRun_site_queuedAt_idx").on(table.siteId, table.queuedAt)],
);

// A third-party service an org attached to the agent (SPEC §10.2 — the connector
// catalog on Automate › Agent). One row per (org, provider).
//
// **No token here, by design.** Unlike slack_workspace — where we hold the credential
// because Slack is our own first-party app and its inbound events need our endpoint —
// these credentials live in Nango's vault and we store only the handle. That's what
// makes §10.2's context model literally true: reads are live API calls through the
// authorizing account's own grant, so a disconnect revokes access instantly and there is
// no durable copy of anyone's data (or of their token) here to leak.
export const integrationConnection = pgTable(
  "integration_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Our connector id (src/lib/integrations/catalog.ts), e.g. "google-drive". Ours
    // rather than Nango's key so renaming an integration there isn't a breaking change.
    provider: text("provider").notNull(),
    // The connection handle Nango generates. Everything we do with the provider is
    // "make this call as connection X" — we never see the access token.
    nangoConnectionId: text("nango_connection_id").notNull(),
    // 'active' | 'revoked' — a connection Nango told us is gone (or that we
    // disconnected) is kept only long enough for the UI to say so; see the store.
    status: text("status").default("active").notNull(),
    connectedByUserId: text("connected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Display detail from the provider (the connected account's email, a drive name).
    // Free-form because every provider reports something different.
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("integrationConnection_organizationId_idx").on(table.organizationId),
    // One connection per provider per org: connecting again re-authorizes rather than
    // accumulating rows, which is also what makes the webhook's upsert well-defined.
    uniqueIndex("integrationConnection_org_provider_idx").on(
      table.organizationId,
      table.provider,
    ),
  ],
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
    // src/lib/sync-runner.ts), plus 'publish' | 'create' (hosted) and 'rollback'. Drives
    // the feed's label ("GitHub push" vs "Manual re-sync"); null on rows that predate the
    // column. Mirrored by DeploymentTrigger in src/lib/deployment-log.ts.
    trigger: text("trigger"),
    // The content revision this deployment put live. For an ordinary deploy it equals the
    // deployment's own id (the row IS the revision that produced it, so there's no separate
    // revision table). For a **rollback** it points at the TARGET's revision — which is what
    // makes a rollback a first-class deployment rather than a mutation of history, and lets
    // several rollbacks to the same revision each keep their own row.
    // NULL on rows that predate revisions; those have no bytes to restore, so the Activity
    // feed correctly offers them no Roll back button.
    revisionId: text("revision_id"),
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
// Autumn is the billing source of truth (plans, entitlements, subscriptions, balances, and the
// Stripe objects under them — src/lib/billing/autumn.ts). What remains in OUR database is only
// what Autumn does not model for us:
//   - credit_rate_version — the token->credit rate tables we rate usage with (append-only).
//   - usage_event — one row per AI operation, rated at write time: WHICH feature spent the
//     credits, which is what Settings -> Usage draws and what rate calibration reads.
// The plan catalog, the Stripe customer/subscription mirrors, the webhook event log and the
// credit ledger/balance cache that used to live here were dropped in the contract migration
// (0033) once no code read them — see SPEC §10's Autumn decision note.

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

export const usageEventRelations = relations(usageEvent, ({ one }) => ({
  organization: one(organization, {
    fields: [usageEvent.organizationId],
    references: [organization.id],
  }),
  site: one(site, { fields: [usageEvent.siteId], references: [site.id] }),
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

export const slackWorkspaceRelations = relations(slackWorkspace, ({ one }) => ({
  organization: one(organization, {
    fields: [slackWorkspace.organizationId],
    references: [organization.id],
  }),
}));

export const integrationConnectionRelations = relations(integrationConnection, ({ one }) => ({
  organization: one(organization, {
    fields: [integrationConnection.organizationId],
    references: [organization.id],
  }),
}));

export const agentRunRelations = relations(agentRun, ({ one }) => ({
  organization: one(organization, {
    fields: [agentRun.organizationId],
    references: [organization.id],
  }),
  site: one(site, { fields: [agentRun.siteId], references: [site.id] }),
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

/**
 * One published version of one page (SPEC §10.11) — the history behind the editor's Version
 * history panel.
 *
 * PUBLISH-level, not save-level. A row per publish is a meaningful unit ("what did this page
 * look like on Tuesday") and is naturally bounded; snapshotting every save would mean thousands
 * of rows per page from an editor that autosaves, plus a retention policy before it was useful
 * at all. Save-level history can layer onto this table later.
 *
 * `content` is stored only for Papervine-hosted sites, where the bytes exist nowhere else — a
 * native publish overwrites its objects in place. A Git-backed site keeps `content` null and
 * stores `commitSha`: the repo already holds every version, so duplicating page bodies into this
 * table would be storing a second copy of somebody's git history.
 */
export const pageVersion = pgTable(
  "page_version",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => site.id, { onDelete: "cascade" }),
    // Docs-relative FILE path (`guides/auth.mdx`), not the URL slug — it's what both the draft
    // buffer and the repo address, and a page can change slug without changing file.
    path: text("path").notNull(),
    // The page as published. Null on a Git-backed site; fetch by `commitSha` instead.
    content: text("content"),
    // sha256 of the content, so an unchanged page doesn't record a version on every publish.
    contentSha: text("content_sha").notNull(),
    // Git-backed sites only: the commit this version was published as.
    commitSha: text("commit_sha"),
    // Who published. Null for an automation's publish, which has no user behind it.
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    // The deployment this belonged to — the join back to the activity feed.
    deploymentId: text("deployment_id"),
    publishedAt: timestamp("published_at").defaultNow().notNull(),
  },
  (table) => [
    // The panel's only query: newest-first for one page of one site.
    index("pageVersion_site_path_idx").on(table.siteId, table.path, table.publishedAt),
  ],
);

export const rateLimit = pgTable("rate_limit", {
  // `{surface}:{hashed ip}` — see rateLimitKey(). Never contains a raw IP.
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start").notNull(),
});
