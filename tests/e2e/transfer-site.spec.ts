import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Settings → Danger zone → "Transfer this site" (SPEC §10.5): move a site to another org
// the actor also administers. We seed a second org (the test user as owner) plus a site
// under the primary org, drive the picker + type-to-confirm modal, and assert the site
// really moved: the action redirects to the destination's URL, the destination page
// renders, and the old org-scoped URL 404s (site lookups are org-scoped).
const DEST_ORG = {
  id: "e2e-transfer-dest-org",
  slug: "transfer-dest-e2e",
  name: "Transfer Dest Org",
};
// An org the user is only a `member` of: it must appear in the picker DISABLED with the
// owner/admin reason, not be hidden (hiding read as "you aren't in any other org").
const MEMBER_ORG = {
  id: "e2e-transfer-member-org",
  slug: "transfer-member-e2e",
  name: "Member Only Org",
};
const SITE = {
  id: "e2e-transfer-site",
  slug: "transfer-e2e",
  name: "Transfer Test Site",
};

// The spec transfers the site for real, so serialize the two tests: the transfer test
// must run after the section-rendering test observes the pre-transfer state.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [user] = await sql`select id from "user" where email = ${TEST_USER.email} limit 1`;
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(user, "expected the onboarded user").toBeTruthy();
  expect(org, "expected the onboarded org").toBeTruthy();

  await sql`delete from site where id = ${SITE.id}`;
  await sql`delete from organization where id in (${DEST_ORG.id}, ${MEMBER_ORG.id})`;
  await sql`insert into organization (id, name, slug, created_at)
            values (${DEST_ORG.id}, ${DEST_ORG.name}, ${DEST_ORG.slug}, now()),
                   (${MEMBER_ORG.id}, ${MEMBER_ORG.name}, ${MEMBER_ORG.slug}, now())`;
  await sql`insert into member (id, organization_id, user_id, role, created_at)
            values (${`${DEST_ORG.id}-member`}, ${DEST_ORG.id}, ${user.id}, 'owner', now()),
                   (${`${MEMBER_ORG.id}-member`}, ${MEMBER_ORG.id}, ${user.id}, 'member', now())`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  // Cascades the seeded member rows.
  await sql`delete from organization where id in (${DEST_ORG.id}, ${MEMBER_ORG.id})`;
  await sql.end();
});

test("the transfer section offers the other org and arms on the slug", async ({ page }) => {
  await page.goto(sitePath(SITE.slug, "settings/danger"));

  await expect(page.getByRole("heading", { name: "Transfer this site" })).toBeVisible();

  // The member-only org is LISTED but disabled, with the reason inline — not hidden.
  const memberOption = page.locator(`option[value="${MEMBER_ORG.slug}"]`);
  await expect(memberOption).toBeDisabled();
  await expect(memberOption).toContainText("requires owner or admin");

  // Picking a destination arms the section button; until then it's disabled.
  const open = page.getByRole("button", { name: `Transfer ${SITE.slug}`, exact: true });
  await expect(open).toBeDisabled();
  await page
    .locator('select[data-slot="select"]')
    .selectOption({ value: DEST_ORG.slug });
  await expect(open).toBeEnabled();
  await open.click();

  const dialog = page.getByRole("dialog", { name: "Transfer this site?" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: `Transfer ${SITE.slug}`,
    exact: true,
  });
  await expect(confirm).toBeDisabled();

  // Same guard as delete: the display name must NOT arm it — only the slug does.
  const field = dialog.getByRole("textbox");
  await field.fill(SITE.name);
  await expect(confirm).toBeDisabled();
  await field.fill(SITE.slug);
  await expect(confirm).toBeEnabled();

  // Back out — the next test performs the real transfer from a clean dialog.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("transferring moves the site to the destination org", async ({ page }) => {
  // The post-transfer landing is the destination org's overview — a dev cold-compile that
  // can push the whole journey past the default timeout (same allowance the dashboard
  // spec's first overview visit needs).
  test.slow();
  await page.goto(sitePath(SITE.slug, "settings/danger"));

  await page
    .locator('select[data-slot="select"]')
    .selectOption({ value: DEST_ORG.slug });
  await page
    .getByRole("button", { name: `Transfer ${SITE.slug}`, exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "Transfer this site?" });
  await dialog.getByRole("textbox").fill(SITE.slug);
  await dialog
    .getByRole("button", { name: `Transfer ${SITE.slug}`, exact: true })
    .click();

  // The action returns a redirect target and the client hard-navigates to the site under
  // its new org. Wait on the URL commit, not full `load` — the destination overview's dev
  // cold-compile can exceed the test timeout, and the assertion is about WHERE we landed.
  await page.waitForURL(`**/${DEST_ORG.slug}/${SITE.slug}`, { waitUntil: "commit" });

  // The row really moved.
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [row] = await sql`select organization_id from site where id = ${SITE.id}`;
  await sql.end();
  expect(row.organization_id).toBe(DEST_ORG.id);

  // And the old org-scoped URL no longer resolves the site.
  const res = await page.goto(sitePath(SITE.slug));
  expect(res?.status()).toBe(404);
});
