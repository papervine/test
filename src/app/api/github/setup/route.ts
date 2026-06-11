import { type NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubInstallation } from "@/lib/db/app-schema";
import { getSession, listOrganizations } from "@/lib/session";
import { fetchInstallation } from "@/lib/github-app";

/**
 * GitHub App "Setup URL" callback (SPEC §3). After an owner installs the App, GitHub
 * redirects the browser here with ?installation_id&setup_action&state. This route lives
 * on the **app host** (unlike the webhook on the apex) because it needs the session to
 * know which org installed — and the session cookie is host-only on the app host. We tie
 * the installation to the session's org, then return to the connect page.
 */
export async function GET(req: NextRequest) {
  // This route is under /api/, which middleware passes through WITHOUT the app-host auth
  // gate — so unlike a page, it can be hit with no session. listOrganizations() throws an
  // Unauthorized APIError in that case, so guard it: any auth failure → bounce to login
  // (where the gate sends them right back here once signed in).
  let session: Awaited<ReturnType<typeof getSession>> = null;
  let org: Awaited<ReturnType<typeof listOrganizations>>[number] | undefined;
  try {
    session = await getSession();
    org = (await listOrganizations())?.[0];
  } catch {
    session = null;
  }
  if (!session || !org) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const back = NextResponse.redirect(new URL(`/${org.slug}/connect`, req.url));

  const idParam = req.nextUrl.searchParams.get("installation_id");
  const installationId = idParam ? Number(idParam) : NaN;
  // A "request" setup_action (org admin must approve) or a missing id has nothing to
  // store yet — just return to connect; the install webhook/next visit will catch up.
  if (!Number.isInteger(installationId)) return back;

  const info = await fetchInstallation(installationId);

  // Upsert: an install can be re-run or moved between orgs. Key on the unique
  // installation_id; refresh the owning org + account label.
  const existing = await db
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, installationId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(githubInstallation)
      .set({
        organizationId: org.id,
        accountLogin: info?.accountLogin ?? existing[0].accountLogin,
        updatedAt: new Date(),
      })
      .where(eq(githubInstallation.installationId, installationId));
  } else {
    await db.insert(githubInstallation).values({
      id: randomUUID(),
      organizationId: org.id,
      installationId,
      accountLogin: info?.accountLogin ?? "",
    });
  }

  return back;
}
