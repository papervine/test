"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, githubInstallation, deployment } from "@/lib/db/app-schema";
import { syncInFlight } from "@/lib/overview";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import {
  fetchRepo,
  hasDocsConfig,
  parseRepoInput,
  normalizeDocsPath,
} from "@/lib/github";
import { getInstallationToken } from "@/lib/github-app";
import { runSync } from "@/lib/sync-runner";
import { revalidateSiteRow } from "@/lib/tenant";
import { encryptSecret } from "@/lib/crypto";
import { slugify, RESERVED_SITE_SLUGS } from "@/lib/slug";
import { openDeployment, resolveDeployment, markSiteLive } from "@/lib/deployment-log";
import { isNativeSite, hasGitRepo } from "@/lib/site-source";
import { starterTemplate } from "@/lib/site-template";
import { TEXT_CONTENT_TYPE } from "@/lib/sync-plan";
import { putObject } from "@/lib/storage";
import { revalidateSite } from "@/lib/s3-source";
import { canRollBack, revisionPrefix } from "@/lib/revisions";
import { revisionExists } from "@/lib/revision-store";
import { normalizeSiteName } from "@/lib/site-name";
import { siteBase, siteRoute, postCreateHref } from "@/lib/dashboard-nav";

// `redirectTo` is the new site's bare URL; the client does the navigation. A server
// redirect() here would be followed as a soft RSC nav that skips the app-host Host
// rewrite (the documented tenant-URL gotcha), landing on the apex instead of the site.
export type ConnectState = { error?: string; redirectTo?: string };

// Globally-unique site slug (it's the subdomain on the tenant domain). Append -2, -3… on
// collision, and treat a reserved slug as taken so it falls through to "<root>-2".
// The list itself lives in lib/slug.ts — this is a "use server" file and may only export
// async functions, and the unit test needs to read it.
async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "site";
  const taken = new Set(
    (await db.select({ slug: site.slug }).from(site).where(like(site.slug, `${root}%`))).map(
      (r) => r.slug,
    ),
  );
  if (!taken.has(root) && !RESERVED_SITE_SLUGS.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

/**
 * Insert a site, minting its slug and retrying on a slug collision.
 *
 * `uniqueSlug` is check-then-insert against a UNIQUE column, so two people creating a site
 * with the same name at the same moment both see the slug as free and one insert loses with
 * a 23505 — which used to surface as a 500. Blank sites make this far likelier (everyone
 * types "Docs"), so the loser just re-mints and tries again; by then the winner's row is
 * visible, so the retry picks the next suffix.
 */
async function insertSiteWithUniqueSlug(
  nameForSlug: string,
  values: Omit<typeof site.$inferInsert, "id" | "slug" | "widgetId">,
): Promise<typeof site.$inferSelect> {
  const ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      const [created] = await db
        .insert(site)
        .values({
          ...values,
          id: randomUUID(),
          slug: await uniqueSlug(nameForSlug),
          widgetId: `widget_${randomUUID()}`,
        })
        .returning();
      return created;
    } catch (err) {
      if (attempt >= ATTEMPTS || !isSlugCollision(err)) throw err;
    }
  }
}

function isSlugCollision(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    typeof err.cause === "object" &&
    err.cause !== null &&
    "code" in err.cause &&
    err.cause.code === "23505" &&
    "constraint_name" in err.cause &&
    err.cause.constraint_name === "site_slug_unique"
  );
}

export async function connectRepo(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return { error: "Not signed in." };

  const name = String(formData.get("name") ?? "").trim();
  const repoRaw = String(formData.get("repo") ?? "");
  const branchInput = String(formData.get("branch") ?? "").trim();
  // Optional fine-grained PAT (Contents: read) for a private repo. When present, every
  // GitHub call is authenticated and the token is stored encrypted for re-syncs.
  const token = String(formData.get("token") ?? "").trim() || undefined;
  // "docs.json is in a subdirectory": the path is only meaningful when the toggle is on,
  // and the client omits the field when off — so an empty value means repo root.
  const docsPath = normalizeDocsPath(String(formData.get("docsPath") ?? ""));
  if (!name) return { error: "Give your site a name." };

  const parsed = parseRepoInput(repoRaw);
  if (!parsed) return { error: "Enter a repo as owner/name or a github.com URL." };

  // Credentials, in precedence order: a pasted PAT wins (the user's explicit choice),
  // else the org's GitHub App installation (preferred — auto-rotating, no secret to
  // store). Either authenticates the validation calls below and backs later syncs; a
  // public repo needs neither.
  const install = (
    await db
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.organizationId, org.id))
      .limit(1)
  )[0];
  const installToken = install ? await getInstallationToken(install.installationId) : undefined;
  const authToken = token ?? installToken;

  const repo = await fetchRepo(parsed.owner, parsed.name, authToken);
  if (!repo) {
    return {
      error: authToken
        ? "Repository not found, or the credentials can't read it (needs Contents: read on this repo)."
        : "Repository not found, or it's private — install the GitHub App or paste a token below.",
    };
  }

  const branch = branchInput || repo.defaultBranch;
  if (!(await hasDocsConfig(parsed.owner, parsed.name, branch, authToken, docsPath))) {
    const where = docsPath ? `in ${docsPath}/ of` : "at the root of";
    return { error: `No docs.json or mint.json ${where} ${repo.fullName}@${branch}.` };
  }

  // Insert as a draft (the schema default); runSync promotes it to 'live' once the first
  // sync succeeds. Persist whichever credential was used: a PAT → repoTokenEnc; otherwise
  // attribute the site to the App installation so syncs/webhooks mint installation tokens
  // (§3 seam).
  const created = await insertSiteWithUniqueSlug(name, {
    organizationId: org.id,
    name,
    repoOwner: parsed.owner,
    repoName: parsed.name,
    branch,
    docsPath,
    isPrivate: repo.private,
    repoTokenEnc: token ? encryptSecret(token) : null,
    githubInstallationId: token ? null : (install?.installationId ?? null),
  });

  // Clear any negative cache for this slug so the brand-new site resolves immediately rather
  // than after the TTL (the slug is freshly unique, so normally a no-op — cheap insurance).
  revalidateSiteRow({ slug: created.slug });

  // Pre-create the 'building' deployment row, then run the (slow) repo→storage copy in the
  // BACKGROUND so the user isn't stuck on the form for the whole sync (a big repo is ~60s).
  // The row exists before we return, so the site page they're redirected to immediately shows
  // the in-progress sync and its Activity feed polls it to live/failed. `after` keeps the
  // function alive past the response — the same deferral the push webhook uses — within the
  // route's maxDuration. runSync records its own failed deployment and shouldn't throw, but
  // we guard anyway (the row's there either way; orphan detection reaps a killed run).
  const deploymentId = await openDeployment({
    siteId: created.id,
    trigger: "connect",
    commitMessage: "Connecting repository…",
    actorUserId: session.user.id,
    // The page we're about to send them to renders this row server-side, so a realtime
    // ping would announce it to a feed that isn't mounted yet.
    notify: false,
  });
  after(async () => {
    try {
      await runSync(created, { actorUserId: session.user.id, trigger: "connect", deploymentId });
    } catch (e) {
      console.error(`[connect] runSync threw for site ${created.id}`, e);
    }
  });

  return { redirectTo: siteBase(org.slug, created.slug) };
}

/**
 * Create a Papervine-hosted site — the "start from scratch" path of the add-site chooser
 * (SPEC §10.11). No repo, no GitHub account required: the site is seeded with starter
 * content so it renders immediately, and from then on it's written in Studio and published
 * straight to object storage.
 *
 * Seeding runs INLINE rather than in `after()`: it's three sub-1KB writes, and the
 * alternative is landing someone on a site that 404s for a beat before flipping live.
 */
export async function createBlankSite(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return { error: "Not signed in." };

  const named = normalizeSiteName(String(formData.get("name") ?? ""));
  if ("error" in named) return { error: named.error };
  const { name } = named;

  // Left at the schema's 'draft' default until the content is actually in storage, so a
  // crash between insert and seed leaves a visibly-unfinished site rather than a live one
  // whose every page 500s on a missing docs.json.
  const created = await insertSiteWithUniqueSlug(name, {
    organizationId: org.id,
    name,
    sourceKind: "native",
    // Explicitly repo-less. `branch` keeps its 'main' default as an inert label for the
    // published stream — the draft store keys sessions on a branch string either way.
    repoOwner: null,
    repoName: null,
    githubInstallationId: null,
    repoTokenEnc: null,
  });
  // Clear any negative cache for this slug so the brand-new site resolves immediately
  // rather than after the TTL.
  revalidateSiteRow({ slug: created.slug });

  const startedAt = Date.now();
  const deploymentId = await openDeployment({
    siteId: created.id,
    trigger: "create",
    commitMessage: "Created a blank site",
    actorUserId: session.user.id,
    notify: false,
  });

  const files = starterTemplate({ name });
  try {
    // In template order — docs.json LAST, so navigation never references pages that
    // haven't landed yet (see site-template.ts).
    for (const file of files) {
      await putObject(
        `${revisionPrefix(created.id, deploymentId)}${file.path}`,
        file.content,
        TEXT_CONTENT_TYPE,
      );
    }
  } catch (e) {
    console.error(`[create] seeding starter content failed for site ${created.id}`, e);
    await resolveDeployment(deploymentId, {
      siteId: created.id,
      ok: false,
      commitMessage: "Created a blank site",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    });
    return { error: "Couldn't create the starter content. Try again." };
  }

  revalidateSite(created.id);
  // Promotes to live and bumps updatedAt — which IS this site's whole content-cache version
  // key (its commit sha is null forever). A brand-new site has no automations, and firing
  // content_update on creation would be semantically wrong anyway.
  await markSiteLive(created, { revisionId: deploymentId, fireAutomations: false });
  await resolveDeployment(deploymentId, {
    siteId: created.id,
    ok: true,
    commitMessage: "Created a blank site",
    // The starter revision. Recording it makes the site's very first state something you can
    // get back to — for a hosted site that's the only "known good" it has.
    revisionId: deploymentId,
    filesAdded: files.length,
    durationMs: Date.now() - startedAt,
  });

  // Studio for anyone who can see it, Overview otherwise — the client hard-navigates,
  // because a server redirect would skip the app-host Host rewrite.
  const role = await getMemberRole(org.id, session.user.id);
  return { redirectTo: postCreateHref(org.slug, created.slug, role) };
}

// Re-pull a site's repo into object storage. The manual ("Re-sync" button) counterpart
// to the push webhook (SPEC §3) — both run the same session-less runSync; here the
// session is the authorization, there it's the verified signature.
export async function resyncSite(
  siteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return { ok: false };

  const rows = await db.select().from(site).where(eq(site.id, siteId)).limit(1);
  const s = rows[0];
  if (!s || s.organizationId !== org.id) return { ok: false };
  // There is nothing to re-sync FROM on a Papervine-hosted site — its content is published
  // from the editor. Say so: the button used to be rendered anyway and silently no-op.
  if (isNativeSite(s)) {
    return {
      ok: false,
      error: "This site isn't connected to a repository — publish from the editor instead.",
    };
  }
  if (!hasGitRepo(s)) return { ok: false };

  // INTERIM concurrency guard (SPEC §3 / §10.3): there's no sync queue or lock yet, so two
  // runSyncs on the same site race on the same object-storage prefix and can leave readers a
  // torn tree. The live Activity feed now makes in-flight syncs visible, which invites a
  // re-sync mid-build — so until we add an advisory lock, refuse one while a sync is already
  // in flight (a `building` row younger than the function ceiling; a stale one is an orphaned
  // timed-out run and must not block forever). Doesn't cover webhook↔manual races — that's the
  // real fix below.
  const [building] = await db
    .select({ createdAt: deployment.createdAt })
    .from(deployment)
    .where(and(eq(deployment.siteId, s.id), eq(deployment.status, "building")))
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  if (syncInFlight(building?.createdAt.getTime() ?? null)) {
    return { ok: false, error: "A sync is already in progress — give it a moment." };
  }

  try {
    await runSync(s, { actorUserId: session.user.id, trigger: "manual" });
  } catch (e) {
    console.error(`[resync] runSync threw for site ${s.id}`, e);
  }

  // Refresh the site's Overview so the new deployment shows in its Activity feed. The
  // ResyncButton sits on the site's page; revalidate its INTERNAL route (Next keys the
  // cache by the real /app mount, not the rewritten-away public URL). s.organizationId
  // === org.id here, so org.slug is the right org for this site.
  revalidatePath(siteRoute(org.slug, s.slug));
  return { ok: true };
}

/**
 * Instant rollback (SPEC §10.11): serve an earlier deployment's content again.
 *
 * This writes NO content. Every successful deploy leaves an immutable revision behind, so
 * restoring one is a single pointer flip inside `markSiteLive` — which is why it's instant and
 * why it can't half-succeed. The cost is one LIST to prove the bytes are still there.
 *
 * It still opens its own `building` deployment row: the rollback belongs in the Activity feed
 * as a first-class event ("who put this back, and when"), and the row is also what makes the
 * `syncInFlight` guard cover a rollback racing a sync.
 */
export async function rollBackSite(
  siteId: string,
  deploymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return { ok: false };

  const rows = await db.select().from(site).where(eq(site.id, siteId)).limit(1);
  const s = rows[0];
  if (!s || s.organizationId !== org.id) return { ok: false };

  // Rolling back replaces what every reader sees, so hold it to the same owner/admin bar as
  // `deleteSite` rather than the editor's — spelled out the same way, for the same reason.
  const role = await getMemberRole(org.id, session.user.id);
  if (role !== "owner" && role !== "admin") {
    return { ok: false, error: "You don't have permission to roll back this site." };
  }

  const [target] = await db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.siteId, s.id)))
    .limit(1);
  if (!target) return { ok: false, error: "That deployment no longer exists." };
  if (!canRollBack(target, s)) {
    return { ok: false, error: "That deployment can't be restored." };
  }

  // Same interim guard as resyncSite and publishNative — a rollback that lands mid-sync would
  // be overwritten by the flip at the end of that sync, so the restore would silently undo
  // itself moments later.
  const [building] = await db
    .select({ createdAt: deployment.createdAt })
    .from(deployment)
    .where(and(eq(deployment.siteId, s.id), eq(deployment.status, "building")))
    .orderBy(desc(deployment.createdAt))
    .limit(1);
  if (syncInFlight(building?.createdAt.getTime() ?? null)) {
    return { ok: false, error: "A deploy is already in progress — give it a moment." };
  }

  // The row can outlive its bytes once GC has run. "Restoring" an empty prefix would take the
  // site down rather than save it, so prove the tree is there before promising anything.
  const revisionId = target.revisionId!;
  if (!(await revisionExists(s.id, revisionId))) {
    return { ok: false, error: "That version's content has been cleaned up and can't be restored." };
  }

  const startedAt = Date.now();
  const short = target.commitSha ? ` (${target.commitSha.slice(0, 7)})` : "";
  const message = `Rolled back to ${(target.commitMessage || "an earlier deployment").split("\n")[0]}${short}`;
  const rollbackId = await openDeployment({
    siteId: s.id,
    trigger: "rollback",
    commitMessage: message,
    actorUserId: session.user.id,
  });

  try {
    await markSiteLive(s, {
      // The TARGET's sha, not the current one. `markSiteLive` writes this column
      // unconditionally, and `shouldSyncSite` skips a push whose head already equals it — so
      // leaving the bad commit here would both misreport what's live AND make GitHub's
      // redelivery of that commit a no-op. Restoring the old sha is also precisely what lets
      // "push supersedes the rollback" work: the next push is a genuinely new head again.
      commitSha: target.commitSha,
      revisionId,
      // A rollback is an incident action. Firing content_update automations here spends real
      // money mid-incident and, worse, an automation that publishes could re-introduce the
      // very content being rolled away.
      fireAutomations: false,
      fallbackRef: rollbackId,
    });
    await resolveDeployment(rollbackId, {
      siteId: s.id,
      ok: true,
      commitMessage: message,
      commitSha: target.commitSha,
      // The TARGET's revision, not a new one — this row didn't build anything, it re-pointed
      // at an existing tree, and recording that is what makes the feed self-describing.
      revisionId,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error(`[rollback] failed site=${s.id} → revision=${revisionId}`, e);
    await resolveDeployment(rollbackId, {
      siteId: s.id,
      ok: false,
      commitMessage: message,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    });
    return { ok: false, error: "The rollback didn't complete. Try again." };
  }

  revalidateSite(s.id);
  revalidatePath(siteRoute(org.slug, s.slug));
  return { ok: true };
}
