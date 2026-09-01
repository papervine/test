import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TEST_DB_URL } from "./global-setup";
import { APEX_ORIGIN, TEST_S3, sitePath } from "./constants";

// Instant rollback (SPEC §10.11): restoring an earlier deployment re-points the site at that
// deployment's immutable revision. No rebuild, no GitHub, no copying — one pointer flip.
//
// @external: needs MinIO. CI's e2e job has Postgres but not MinIO, so it skips this with
// --grep-invert @external; run locally with `docker compose up`.
//
// Deterministic and GitHub-free: seed a site with TWO revisions already in storage, exactly as
// two successful deploys would have left it, then drive the real Roll back button and read the
// PUBLIC docs URL back. That last part is the point — asserting the DB column flipped would
// pass even if the render path never consulted it.

// Everything this spec addresses is scoped to one run, and both halves of that are load-bearing:
//
//  • **The slug**, because the site row is cached for 60s under `site-row:slug:{slug}` and only
//    a mutation going through `revalidateSiteRow` busts it. Seeding a row with raw SQL doesn't,
//    so a re-run inside the TTL would render the PREVIOUS run's row — pointing at a revision
//    that run has since rolled away from. Any e2e that seeds a site row directly has this trap.
//  • **The revision ids**, because a revision is IMMUTABLE and the content cache keys on its id.
//    Reusing an id while changing what's under it is a contract violation, and the render path
//    will correctly serve the cached bytes forever.
const RUN = randomUUID().slice(0, 8);
const SITE_ID = `e2e-rollback-site-${RUN}`;
const SLUG = `rollback-tenant-${RUN}`;
const OLD_REV = `e2e-rollback-old-${RUN}`;
const NEW_REV = `e2e-rollback-new-${RUN}`;

const OLD_MARKER = "ROLLBACK_OLD_MARKER";
const NEW_MARKER = "ROLLBACK_NEW_MARKER";

// The site NAME is deliberately identical across revisions: it renders in the navbar, so a
// per-revision name would make the marker match twice and the assertions ambiguous. Only the
// page body distinguishes the two revisions.
const DOCS_JSON = JSON.stringify({
  name: "Rollback Tenant",
  navigation: { tabs: [{ tab: "Docs", groups: [{ group: "Guides", pages: ["index"] }] }] },
});

const s3 = new S3Client({
  region: TEST_S3.region,
  endpoint: TEST_S3.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: TEST_S3.accessKeyId, secretAccessKey: TEST_S3.secretAccessKey },
});

async function put(key: string, body: string, contentType = "text/plain") {
  await s3.send(
    new PutObjectCommand({ Bucket: TEST_S3.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

/** Seed one complete revision tree — what a deploy leaves behind. */
async function putRevision(revisionId: string, marker: string) {
  const prefix = `revs/${SITE_ID}/${revisionId}/`;
  await put(`${prefix}docs.json`, DOCS_JSON);
  await put(`${prefix}index.mdx`, `---\ntitle: Home\n---\n${marker}\n`);
}

test.describe("instant rollback @external", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();
    const [user] = await sql`select id from "user" limit 1`;

    await putRevision(OLD_REV, OLD_MARKER);
    await putRevision(NEW_REV, NEW_MARKER);

    // Start on the NEW revision — the state right after a bad deploy went live.
    await sql`delete from site where id = ${SITE_ID}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, live_revision_id)
              values (${SITE_ID}, ${org.id}, 'Rollback Tenant', ${SLUG}, 'acme', 'docs', 'main', 'live', ${NEW_REV})`;

    // Two successful live deployments, each owning its revision. The ids match the revision
    // ids because a deployment IS its revision (SPEC §10.11).
    //
    // NOTE: seeding `revision_id` here means this spec does NOT prove the write paths record
    // it — and that gap once hid a real bug, where `markSiteLive` got the revision but
    // `resolveDeployment` didn't, so the site served correctly while every Roll back button
    // silently vanished. The produce side is pinned at the unit layer instead, per path:
    // `sync-runner-revision.test.ts` and `native-publish.test.ts`. Don't assume this spec
    // covers it.
    await sql`delete from deployment where site_id = ${SITE_ID}`;
    await sql`insert into deployment (id, site_id, status, target, trigger, commit_sha, commit_message, revision_id, actor_user_id, created_at)
              values (${OLD_REV}, ${SITE_ID}, 'successful', 'live', 'webhook', 'aaaaaaa', 'the good one', ${OLD_REV}, ${user?.id ?? null}, now() - interval '2 hours')`;
    await sql`insert into deployment (id, site_id, status, target, trigger, commit_sha, commit_message, revision_id, actor_user_id, created_at)
              values (${NEW_REV}, ${SITE_ID}, 'successful', 'live', 'webhook', 'bbbbbbb', 'the bad one', ${NEW_REV}, ${user?.id ?? null}, now() - interval '5 minutes')`;
  });

  test.afterAll(async () => {
    await sql`delete from site where id = ${SITE_ID}`;
    await sql.end();
  });

  test("restores an earlier deployment's content, without a rebuild", async ({ page }) => {
    test.slow(); // owns this route + the tenant route; both cold-compile on first visit.

    // The bad deploy is what readers get.
    await page.goto(`${APEX_ORIGIN}/sites/${SLUG}`);
    await expect(page.getByText(NEW_MARKER)).toBeVisible({ timeout: 30_000 });

    await page.goto(sitePath(SLUG));
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible({ timeout: 30_000 });

    // The row that's already live must NOT offer a rollback — restoring what you're serving is
    // a no-op that reads as a broken button.
    const liveRow = page.locator("details", { hasText: "the bad one" });
    await liveRow.getByRole("button", { name: "Roll back" }).waitFor({ state: "detached" });

    const oldRow = page.locator("details", { hasText: "the good one" });
    await oldRow.locator("summary").click();
    await oldRow.getByRole("button", { name: "Roll back" }).click();

    // Confirmed, because it changes what every reader sees.
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // A Git-backed site must be told the repo still holds the newer content.
    await expect(dialog).toContainText("next push");
    await dialog.getByRole("button", { name: "Roll back" }).click();

    await expect(page.getByText("Rolled back", { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    // The pointer moved…
    await expect
      .poll(
        async () => {
          const [row] = await sql`select live_revision_id from site where id = ${SITE_ID}`;
          return row?.live_revision_id;
        },
        { timeout: 15_000 },
      )
      .toBe(OLD_REV);

    // …and — the assertion that actually matters — readers are served the old content again.
    // Nothing was rebuilt or re-fetched; only the prefix the render path reads changed.
    //
    // Re-navigating rather than waiting on one render: the docs page is server-rendered, so a
    // single `goto` freezes whatever was true at that instant and no amount of DOM polling will
    // update it. The budget is deliberately well under the 60s site-row TTL — if a rollback were
    // only visible once that TTL lapsed it wouldn't be "instant", and this must fail rather than
    // quietly wait it out.
    await expect
      .poll(
        async () => {
          await page.goto(`${APEX_ORIGIN}/sites/${SLUG}`);
          return page.locator("article, main").first().innerText();
        },
        { timeout: 20_000, intervals: [500, 1000, 2000] },
      )
      .toContain(OLD_MARKER);
    await expect(page.getByText(NEW_MARKER)).toHaveCount(0);

    // The rollback is itself a deployment, so the feed records who restored what.
    const [rollback] =
      await sql`select trigger, status, revision_id, commit_sha from deployment
                where site_id = ${SITE_ID} and trigger = 'rollback' order by created_at desc limit 1`;
    expect(rollback?.status).toBe("successful");
    // It points at the TARGET's revision, not a new one — that's what makes it a restore.
    expect(rollback?.revision_id).toBe(OLD_REV);

    // The site's synced sha must follow the content back, or the webhook's idempotency check
    // would skip a redelivery of the bad commit while claiming to be live on it.
    const [site] = await sql`select last_synced_commit_sha from site where id = ${SITE_ID}`;
    expect(site?.last_synced_commit_sha).toBe("aaaaaaa");
  });
});
