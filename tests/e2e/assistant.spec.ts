import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// The Automate › Assistant page's two *operational* toggles (SPEC §8.6) — Assistant
// Status and Invisible CAPTCHA — are DB state (instant effect, no Git commit), wired the
// same way as the reader-auth kill switch. This spec proves the round-trip: the switch
// reflects the stored value, a click persists, and a reload re-reads it from the DB.
const SITE = { id: "e2e-assistant-site", slug: "e2e-assistant", name: "Assistant E2E" };

const assistantPath = sitePath(SITE.slug, "automate/assistant");

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  // Seed both toggles OFF so a successful enable is unambiguous (the column default is ON).
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                             assistant_enabled, assistant_captcha_enabled)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live',
                    false, false)`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("the status toggle reflects DB state, persists on click, and survives reload", async ({
  page,
}) => {
  await page.goto(assistantPath);

  const status = page.getByRole("switch", { name: "Enable assistant" });
  // Seeded OFF → switch off, badge reads Inactive.
  await expect(status).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Inactive")).toBeVisible();

  // Click enables it: the badge flips to Active without a reload (optimistic + refresh).
  await status.click();
  await expect(page.getByText("Active")).toBeVisible();
  await expect(status).toHaveAttribute("aria-checked", "true");

  // Reload re-reads from the DB — the enable persisted, not just local state. The
  // switch flips optimistically before the server action commits, so an immediate
  // reload can race the write: retry reload+assert until it settles (a genuinely
  // lost write still fails — it never becomes true).
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("switch", { name: "Enable assistant" })).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("Active")).toBeVisible();
});

test("the CAPTCHA toggle persists independently and survives reload", async ({ page }) => {
  await page.goto(assistantPath);

  const captcha = page.getByRole("switch", { name: "Enable invisible CAPTCHA" });
  await expect(captcha).toHaveAttribute("aria-checked", "false");

  await captcha.click();
  await expect(captcha).toHaveAttribute("aria-checked", "true");

  // Same optimistic-flip vs server-write race as the status toggle above.
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Enable invisible CAPTCHA" }),
    ).toHaveAttribute("aria-checked", "true", { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
});
