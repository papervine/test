"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, deployment } from "@/lib/db/app-schema";
import { getSession, listOrganizations } from "@/lib/session";
import {
  fetchRepo,
  hasDocsConfig,
  fetchLatestCommit,
  parseRepoInput,
  normalizeDocsPath,
} from "@/lib/github";
import { syncSite, type SyncResult } from "@/lib/sync";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { revalidateSite } from "@/lib/s3-source";
import { slugify } from "@/lib/slug";
import { syncErrorDetail } from "@/lib/sync-error";
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

  const repo = await fetchRepo(parsed.owner, parsed.name, token);
  if (!repo) {
    return {
      error: token
        ? "Repository not found, or the token can't read it (needs Contents: read on this repo)."
        : "Repository not found, or it's private — paste a token below to connect a private repo.",
    };
  }

  const branch = branchInput || repo.defaultBranch;
  if (!(await hasDocsConfig(parsed.owner, parsed.name, branch, token, docsPath))) {
    const where = docsPath ? `in ${docsPath}/ of` : "at the root of";
    return { error: `No docs.json or mint.json ${where} ${repo.fullName}@${branch}.` };
  }

  const commit = await fetchLatestCommit(parsed.owner, parsed.name, branch, token);
  const slug = await uniqueSlug(name);
  const siteId = randomUUID();

  await db.insert(site).values({
    id: siteId,
    organizationId: org.id,
    name,
    slug,
    repoOwner: parsed.owner,
    repoName: parsed.name,
    branch,
    docsPath,
    isPrivate: repo.private,
    repoTokenEnc: token ? encryptSecret(token) : null,
    status: "live",
  });

  // Copy the repo's content into object storage so the render path reads from us,
  // not GitHub (SPEC §3.1 model C). A failed sync shouldn't lose the connection —
  // record it as failed and let the user re-sync.
  let result: SyncResult | null = null;
  let error: string | null = null;
  try {
    result = await syncSite({ id: siteId, repoOwner: parsed.owner, repoName: parsed.name, branch, token, docsPath });
    revalidateSite(siteId); // drop any stale Data Cache entries for this site's content
  } catch (e) {
    console.error("initial sync failed", e);
    error = syncErrorDetail(e);
  }

  await db.insert(deployment).values({
    id: randomUUID(),
    siteId,
    status: result ? "successful" : "failed",
    target: "live",
    commitSha: commit?.sha ?? null,
    commitMessage: commit?.message ?? "Connected repository",
    error,
    filesAdded: result?.files ?? 0,
    actorUserId: session.user.id,
  });

  return { redirectTo: siteBase(org.slug, slug) };
}

// Re-pull a site's repo into object storage (manual sync; webhooks come in C-full).
export async function resyncSite(siteId: string): Promise<void> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return;

  const rows = await db.select().from(site).where(eq(site.id, siteId)).limit(1);
  const s = rows[0];
  if (!s || s.organizationId !== org.id || !s.repoOwner || !s.repoName) return;

  // Private repos: decrypt the stored token so the re-sync can authenticate.
  const token = s.repoTokenEnc ? decryptSecret(s.repoTokenEnc) : undefined;

  let result: SyncResult | null = null;
  let error: string | null = null;
  try {
    result = await syncSite({ id: s.id, repoOwner: s.repoOwner, repoName: s.repoName, branch: s.branch, token, docsPath: s.docsPath });
    revalidateSite(s.id); // serve the fresh content immediately, not the cached pre-sync copy
  } catch (e) {
    console.error("resync failed", e);
    error = syncErrorDetail(e);
  }

  await db.insert(deployment).values({
    id: randomUUID(),
    siteId: s.id,
    status: result ? "successful" : "failed",
    target: "live",
    commitMessage: result ? `Re-synced ${result.files} files` : "Re-sync failed",
    error,
    filesEdited: result?.files ?? 0,
    actorUserId: session.user.id,
  });

  // Refresh the site's Overview so the new deployment shows in its Activity feed. The
  // ResyncButton sits on the site's page; revalidate its INTERNAL route (Next keys the
  // cache by the real /app mount, not the rewritten-away public URL). s.organizationId
  // === org.id here, so org.slug is the right org for this site.
  revalidatePath(siteRoute(org.slug, s.slug));
}
