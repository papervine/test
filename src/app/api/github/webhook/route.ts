import { after, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { site as siteTable, githubInstallation } from "@/lib/db/app-schema";
import {
  verifySignature,
  parsePushPayload,
  shouldSyncSite,
} from "@/lib/github-webhook";
import { runSync } from "@/lib/sync-runner";

// The push sync runs in after() (below); give it real headroom so a large repo's sync
// isn't killed mid-flight after we've already returned 202 — 60s sat right AT a big
// repo's sync time (intermittent kills); 300 is the Fluid Compute cap on Hobby.
export const maxDuration = 300;

/**
 * GitHub App webhook (SPEC §3 — push auto-sync). The App is registered with this URL on
 * the **apex** host (papervine.io/api/github/webhook), where middleware passes /api/
 * straight through with no auth gate — the app host would redirect GitHub's unauthed POST
 * to /login. Authorization here is the HMAC signature, not a session.
 *
 * GitHub wants a fast 2xx (it times out slow deliveries and retries), so we verify, map
 * the push to sites, and run the (potentially slow) syncs in `after()` — responding 202
 * immediately. `after()` keeps the function alive past the response on Vercel; a very
 * large repo could still approach the function time cap — a real queue is the later
 * optimization, but for docs repos this is comfortably enough.
 */
export async function POST(req: NextRequest) {
  // Signature is over the RAW bytes — read text() and verify BEFORE parsing.
  const raw = await req.text();
  const ok = verifySignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    process.env.GITHUB_APP_WEBHOOK_SECRET,
  );
  if (!ok) return new Response("bad signature", { status: 401 });

  const event = req.headers.get("x-github-event");
  const payload = JSON.parse(raw);

  if (event === "ping") return new Response(null, { status: 204 });

  // Keep our installation records in sync. Creation is owned by the setup callback (it
  // has the session → knows the org); here we handle removal so an uninstalled App stops
  // being used for syncs and the dependent sites fall back to draft/PAT.
  if (event === "installation") {
    if (payload.action === "deleted") {
      const installationId = payload.installation?.id as number | undefined;
      if (installationId != null) {
        await db
          .update(siteTable)
          .set({ githubInstallationId: null })
          .where(eq(siteTable.githubInstallationId, installationId));
        await db
          .delete(githubInstallation)
          .where(eq(githubInstallation.installationId, installationId));
      }
    }
    return new Response(null, { status: 204 });
  }

  if (event !== "push") return new Response(null, { status: 204 });

  const push = parsePushPayload(payload);
  if (!push) return new Response(null, { status: 204 }); // tag / branch-delete / malformed

  // All sites pointing at this repo (any org). GitHub repo names are case-insensitive, and
  // a site stores whatever the user typed, so match case-insensitively rather than miss a
  // sync on a casing difference.
  const sites = await db
    .select()
    .from(siteTable)
    .where(
      and(
        sql`lower(${siteTable.repoOwner}) = ${push.owner.toLowerCase()}`,
        sql`lower(${siteTable.repoName}) = ${push.repo.toLowerCase()}`,
      ),
    );

  const toSync = sites.filter((s) => shouldSyncSite(push, s));
  if (toSync.length === 0) return new Response(null, { status: 204 });

  // Run the syncs after responding so GitHub gets its fast 2xx. A webhook sync has no
  // actor (it's a system sync); the push payload carries the head commit, so the runner
  // skips its own commit lookup.
  after(async () => {
    for (const s of toSync) {
      await runSync(s, {
        trigger: "webhook",
        actorUserId: null,
        commit: { sha: push.headSha, message: push.headMessage },
      });
    }
  });

  return new Response(`syncing ${toSync.length} site(s)`, { status: 202 });
}
