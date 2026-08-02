import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Widget settings (SPEC §8.7): an owner enables the embeddable assistant widget, manages
// its origin allowlist, and copies the real embed snippet. Deterministic — seeds a site
// under the seeded org (no GitHub/MinIO) and opens its URL-scoped settings page directly.
const SITE = { id: "e2e-widget-site", slug: "e2e-widget", name: "Widget E2E" };

const widgetPath = sitePath(SITE.slug, "settings/widget");

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                             widget_enabled)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live',
                    false)`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql.end();
});

test("mints a widget id, persists availability, rejects bad origins, and saves good ones", async ({
  page,
}) => {
  await page.goto(widgetPath);
  await expect(
    page.getByRole("heading", { name: "Embed the assistant on any site" }),
  ).toBeVisible();

  // A fresh site gets a widget id lazily on first visit — the embed snippet already
  // contains a real one, not a placeholder.
  const widgetIdBox = page.locator("code").filter({ hasText: /^widget_/ });
  await expect(widgetIdBox).toBeVisible();
  const widgetId = (await widgetIdBox.textContent())!.trim();
  expect(widgetId).toMatch(/^widget_[0-9a-f-]{36}$/);

  // Availability persists.
  const availability = page.getByRole("switch", { name: "Enable widget" });
  await expect(availability).toHaveAttribute("aria-checked", "false");
  await availability.click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("switch", { name: "Enable widget" })).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 15_000 });

  // A path/wildcard origin is rejected with a clear error, not silently accepted.
  await page.getByPlaceholder("https://docs.example.com").fill("https://example.com/path");
  await page.getByRole("button", { name: "+ Add domain" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/isn't a valid origin/)).toBeVisible();

  // Remove the bad entry, add a good one, save — it persists to the DB.
  await page.getByRole("button", { name: /^Remove/ }).click();
  await page.getByPlaceholder("https://docs.example.com").fill("https://allowed.example.com");
  await page.getByRole("button", { name: "+ Add domain" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  const sql = postgres(TEST_DB_URL, { max: 1 });
  await expect
    .poll(async () => {
      const [r] = await sql`select widget_allowed_origins from site where id = ${SITE.id}`;
      return r.widget_allowed_origins;
    })
    .toEqual(["https://allowed.example.com"]);
  await sql.end();

  // The embed snippet reflects the real widget id (copy-pasteable, not a placeholder).
  await expect(page.getByText(widgetId, { exact: false }).first()).toBeVisible();
});
