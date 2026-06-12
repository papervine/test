import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Logged in via the saved session (storageState). The danger zone's type-to-confirm guards
// against the site's *slug*, not its display name — the slug is the identifier shown in the
// URL/subdomain/sidebar, so it's the only string a user can reproduce. We seed a site whose
// name deliberately differs from its slug (the real failure shape: a "sdfdsf" site whose slug
// deduped to "sdfdsf-3"); confirming the name would ask for a string shown nowhere, so the
// Delete button would never arm. SPEC §10.5. Non-destructive: we open the modal and assert
// arming behavior, then cancel — the seeded row is dropped in afterAll, never via the action.
const SITE = {
  id: "e2e-danger-site",
  slug: "danger-zone-e2e",
  name: "Danger Display Name",
};

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("the delete-site section is labelled by slug, not display name", async ({ page }) => {
  await page.goto(sitePath(SITE.slug, "settings/danger"));
  // The red action carries the slug ("Delete danger-zone-e2e"), and nothing is labelled with
  // the display name — the whole regression in one assertion.
  await expect(
    page.getByRole("button", { name: `Delete ${SITE.slug}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Delete ${SITE.name}`, exact: true }),
  ).toHaveCount(0);
});

test("the confirm modal arms on the slug and rejects the display name", async ({ page }) => {
  await page.goto(sitePath(SITE.slug, "settings/danger"));

  // Gate 1: a reason arms the section button that opens the modal.
  await page
    .getByPlaceholder("Why are you deleting your site?")
    .fill("regression: confirm against the slug");
  await page
    .getByRole("button", { name: `Delete ${SITE.slug}`, exact: true })
    .click();

  const dialog = page.getByRole("dialog", { name: "Delete this site" });
  await expect(dialog).toBeVisible();
  // The prompt names the slug, and the final delete starts disabled.
  await expect(
    dialog.getByText(new RegExp(`Type\\s+${SITE.slug}\\s+to confirm`)),
  ).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: `Delete ${SITE.slug}`,
    exact: true,
  });
  await expect(confirm).toBeDisabled();

  const field = dialog.getByRole("textbox");

  // Regression: typing the display name must NOT arm the delete (the old behavior asked for
  // exactly this and so could never be satisfied from the URL).
  await field.fill(SITE.name);
  await expect(confirm).toBeDisabled();

  // Typing the slug — the string in the URL — arms it.
  await field.fill(SITE.slug);
  await expect(confirm).toBeEnabled();

  // Non-destructive: back out without deleting.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
