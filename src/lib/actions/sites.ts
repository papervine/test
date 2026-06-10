"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { site, deployment } from "@/lib/db/app-schema";
import { getSession, listOrganizations } from "@/lib/session";
import { fetchRepo, hasDocsConfig, fetchLatestCommit, parseRepoInput } from "@/lib/github";
import { syncSite, type SyncResult } from "@/lib/sync";
import { revalidateSite } from "@/lib/s3-source";
import { slugify } from "@/lib/slug";
import { syncErrorDetail } from "@/lib/sync-error";
import { ACTIVE_SITE_COOKIE } from "@/lib/active-site";

export type ConnectState = { error?: string };

// Persist the dashboard's active site (the top-left switcher, SPEC §10). Only stores a
// slug the caller actually owns, so a tampered/stale cookie can't scope another org's
// site — resolveActiveSite falls back to the first site if the cookie ever drifts anyway.
export async function setActiveSite(slug: string): Promise<void> {
  const org = (await listOrganizations())?.[0];
  if (!org) return;
  const [owned] = await db
    .select({ slug: site.slug })
    .from(site)
    .where(and(eq(site.organizationId, org.id), eq(site.slug, slug)))
    .limit(1);
  if (!owned) return;

  (await cookies()).set(ACTIVE_SITE_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/dashboard", "layout");
}

// Globally-unique site slug (it's the *.papervine.io subdomain). Append -2, -3… on collision.
async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "site";
  const taken = new Set(
    (await db.select({ slug: site.slug }).from(site).where(like(site.slug, `${root}%`))).map(
      (r) => r.slug,
    ),
  );
  if (!taken.has(root)) return root;
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
  if (!name) return { error: "Give your site a name." };

  const parsed = parseRepoInput(repoRaw);
  if (!parsed) return { error: "Enter a repo as owner/name or a github.com URL." };

  const repo = await fetchRepo(parsed.owner, parsed.name);
  if (!repo) return { error: "Repository not found, or it isn't public." };

  const branch = branchInput || repo.defaultBranch;
  if (!(await hasDocsConfig(parsed.owner, parsed.name, branch))) {
    return { error: `No docs.json or mint.json at the root of ${repo.fullName}@${branch}.` };
  }

  const commit = await fetchLatestCommit(parsed.owner, parsed.name, branch);
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
    status: "live",
  });

  // Copy the repo's content into object storage so the render path reads from us,
  // not GitHub (SPEC §3.1 model C). A failed sync shouldn't lose the connection —
  // record it as failed and let the user re-sync.
  let result: SyncResult | null = null;
  let error: string | null = null;
  try {
    result = await syncSite({ id: siteId, repoOwner: parsed.owner, repoName: parsed.name, branch });
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

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// Re-pull a site's repo into object storage (manual sync; webhooks come in C-full).
export async function resyncSite(siteId: string): Promise<void> {
  const session = await getSession();
  const org = (await listOrganizations())?.[0];
  if (!session || !org) return;

  const rows = await db.select().from(site).where(eq(site.id, siteId)).limit(1);
  const s = rows[0];
  if (!s || s.organizationId !== org.id || !s.repoOwner || !s.repoName) return;

  let result: SyncResult | null = null;
  let error: string | null = null;
  try {
    result = await syncSite({ id: s.id, repoOwner: s.repoOwner, repoName: s.repoName, branch: s.branch });
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

  revalidatePath("/dashboard");
}
