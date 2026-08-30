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
  // This spec is the only visitor to `settings/widget`, so its first navigation always
  // cold-compiles the route in `next dev` — and it runs late in a long single-worker run, when
  // the server is least eager. On the default 30s budget that alone timed out the test (the
  // navigation aborts, which the server then logs as "The destination stream closed early" —
  // a symptom of the client giving up, not a separate fault). Same treatment as the other
  // specs that own a cold route: `test.slow()` raises the TEST budget, and the first assertion
  // needs its own headroom because `test.slow()` doesn't touch the per-assertion 5s.
  test.slow();
  await page.goto(widgetPath);
  await expect(
    page.getByRole("heading", { name: "Embed the assistant on any site" }),
  ).toBeVisible({ timeout: 60_000 });

  // A fresh site gets a widget id lazily on first visit — the embed snippet already
  // contains a real one, not a placeholder.
  const widgetIdBox = page.locator("code").filter({ hasText: /^widget_/ });
  await expect(widgetIdBox).toBeVisible();
  const widgetId = (await widgetIdBox.textContent())!.trim();
  expect(widgetId).toMatch(/^widget_[0-9a-f-]{36}$/);

  // Availability persists. Asserted in two steps against two different sources, rather than
  // reloading the whole page in a retry loop until it agrees: polling the DB is faster (no SSR
  // round trip per attempt, where the old loop could spend half the test budget re-rendering a
  // page to observe one boolean), and it splits the failure — "the write never landed" and "the
  // page doesn't reflect the write" are different bugs that the loop reported identically.
  // Same shape as the origins assertion at the end of this test.
  const availability = page.getByRole("switch", { name: "Enable widget" });
  await expect(availability).toHaveAttribute("aria-checked", "false");
  await availability.click();

  const sqlToggle = postgres(TEST_DB_URL, { max: 1 });
  await expect
    .poll(
      async () => {
        const [r] = await sqlToggle`select widget_enabled from site where id = ${SITE.id}`;
        return r.widget_enabled;
      },
      { timeout: 15_000, message: "the availability toggle never persisted to the DB" },
    )
    .toBe(true);
  await sqlToggle.end();

  // …and the persisted value is what a fresh render shows.
  await page.reload();
  await expect(page.getByRole("switch", { name: "Enable widget" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

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

// The owner's own widget runs IN the dashboard once it's enabled (SPEC §8.7) — the real embed
// script, mounted by the shell for whichever site the rail considers active. Its own test rather
// than more assertions on the one above: it needs the opposite precondition proved too (nothing
// mounted while the widget is off), and it stays on the site home, a route other specs already
// compile, instead of paying for another cold one.
test("mounts the site's own assistant widget in the dashboard, and only when enabled", async ({
  page,
}) => {
  // The mount is an effect that injects a script, tears down on site switch, and pokes a
  // third-party-shaped global — the failure mode is a console error (a mount loop, a destroy on
  // a null instance), invisible in the DOM. Same guard as the editor's specs.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  const home = sitePath(SITE.slug);
  // "Ask Assistant" is the `trigger` label the dashboard mount passes, which the embed script
  // uses for both the pill's text and its accessible name.
  const launcher = page.getByRole("button", { name: "Ask Assistant" });
  // Playwright pierces open shadow roots, which is the only way to see this button: the widget
  // mounts into one so a host page's CSS can't reach it.

  // Set the precondition here rather than inheriting whatever the test above left behind — it
  // enables the widget through the UI, so relying on that would make this pass only in file
  // order and only while that test still passes.
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`update site set widget_enabled = false where id = ${SITE.id}`;

  await page.goto(home);
  await expect(page.getByRole("link", { name: "Settings" }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(launcher).toHaveCount(0);
  // Nothing even fetched: the loader tag is injected by the effect, so "off" means no script.
  await expect(page.locator('script[src*="/api/widget/embed.js"]')).toHaveCount(0);

  await sql`update site set widget_enabled = true where id = ${SITE.id}`;
  await sql.end();

  await page.reload();
  await expect(launcher).toBeVisible({ timeout: 30_000 });
  // The labelled pill separates icon from label with flex `gap`, and gap applies only between
  // flex ITEMS — so the icon must be an element, not the bare text node it used to be (which
  // is an anonymous inline box, and sat flush against the label).
  await expect(page.locator(".pv-launcher.pv-launcher-text .pv-launcher-icon")).toHaveCount(1);
  await launcher.click();
  // Named for the site whose dashboard this is — mounting the wrong site's widget would answer
  // from the wrong docs, and the title is the visible tell.
  await expect(page.getByText(`Ask the ${SITE.name} assistant`)).toBeVisible();
  await expect(page.getByPlaceholder("Ask a question…")).toBeVisible();

  const reactErrors = errors.filter(
    (e) =>
      e.startsWith("pageerror:") ||
      /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat|PapervineAssistant/i.test(
        e,
      ),
  );
  expect(reactErrors, `unexpected errors:\n${reactErrors.join("\n")}`).toEqual([]);
});
