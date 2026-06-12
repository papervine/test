"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, githubInstallation, deployment } from "@/lib/db/app-schema";
import { syncInFlight } from "@/lib/overview";
import { getSession, listOrganizations } from "@/lib/session";
import {
  fetchRepo,
  hasDocsConfig,
  parseRepoInput,
  normalizeDocsPath,
} from "@/lib/github";
import { getInstallationToken } from "@/lib/github-app";
import { runSync } from "@/lib/sync-runner";
import { encryptSecret } from "@/lib/crypto";
import { slugify } from "@/lib/slug";
import { siteBase, siteRoute } from "@/lib/dashboard-nav";

// `redirectTo` is the new site's bare URL; the client does the navigation. A server
// redirect() here would be followed as a soft RSC nav that skips the app-host Host
// rewrite (the documented tenant-URL gotcha), landing on the apex instead of the site.
export type ConnectState = { error?: string; redirectTo?: string };

// Site slugs sit beside the org-level `connect` route (/:org/:site vs /:org/connect), so
// a site slugged "connect" would be shadowed by that page — reserve it.
const RESERVED_SITE_SLUGS = new Set(["connect"]);

// Globally-unique site slug (it's the *.papervine.io subdomain). Append -2, -3… on
// collision, and treat a reserved slug as taken so it falls through to "<root>-2".
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

  const slug = await uniqueSlug(name);

  // Insert as a draft (the schema default); runSync promotes it to 'live' once the first
  // sync succeeds. `.returning()` hands back the full row to feed the shared runner.
  // Persist whichever credential was used: a PAT → repoTokenEnc; otherwise attribute the
  // site to the App installation so syncs/webhooks mint installation tokens (§3 seam).
  const [created] = await db
    .insert(site)
    .values({
      id: randomUUID(),
      organizationId: org.id,
      name,
      slug,
      repoOwner: parsed.owner,
      repoName: parsed.name,
      branch,
      docsPath,
      isPrivate: repo.private,
      repoTokenEnc: token ? encryptSecret(token) : null,
      githubInstallationId: token ? null : (install?.installationId ?? null),
    })
    .returning();

  // Copy the repo's content into object storage so the render path reads from us, not
  // GitHub (SPEC §3.1 model C). runSync records its own failed deployment and shouldn't
  // throw, but guard anyway: the site row exists, so we ALWAYS redirect to it (where the
  // Activity feed shows the sync's building/failed state) rather than bubble a raw error
  // up as an opaque client-side exception.
  try {
    await runSync(created, { actorUserId: session.user.id, trigger: "connect" });
  } catch (e) {
    console.error(`[connect] runSync threw for site ${created.id}`, e);
  }

  return { redirectTo: siteBase(org.slug, slug) };
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
  if (!s || s.organizationId !== org.id || !s.repoOwner || !s.repoName) {
    return { ok: false };
  }

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
