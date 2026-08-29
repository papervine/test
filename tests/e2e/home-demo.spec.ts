import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, E2E_PORT } from "./constants";
import { TEST_DB_URL } from "./global-setup";
import { ASSISTANT_POLICY } from "../../src/lib/rate-limit";

// The apex, addressed as `localhost` rather than `127.0.0.1` — and that difference is
// load-bearing, not cosmetic.
//
// The demo resolves its site from `docs.{apex}` through getSiteByCustomDomain, which is an
// `unstable_cache` read with a 60s TTL keyed on that domain. Playwright's own webServer HEALTH
// CHECK polls `http://127.0.0.1:3210/` to decide the server is up — which renders the marketing
// home, finds no demo site (this file's beforeAll hasn't run yet; the health check is what
// releases Playwright to run it) and caches a NULL against `docs.127.0.0.1` for the next
// minute. Every later render on that host then serves the cached null and the chips degrade to
// links, no matter what the row says.
//
// Nothing invalidates it, because a spec inserting straight into Postgres bypasses the
// `revalidateSiteRow` call that real site creation makes. Addressing the apex as `localhost`
// gives a different cache key (`docs.localhost`) that the health check never warmed — and it
// matches how `npm run db:seed` sets the demo up in dev.
const HOME_ORIGIN = `http://localhost:${E2E_PORT}`;

// The marketing home's "Try it" section (SPEC §2). Both halves are the REAL product, so both
// need a browser to verify: the editor is TipTap over an in-memory MDX string (its `/` menu
// and the live source pane are unobservable from the DOM alone), and the Ask chips drive the
// embeddable widget's own shadow-root UI.
//
// This spec lives on the APEX origin, not the app host baseURL — the marketing home is an apex
// route, and the demo resolves its site from the request Host.

// The site the "Ask" demo resolves to: whichever site claims `docs.{apex}` as its custom domain.
// We address the apex as localhost (see HOME_ORIGIN above), so that key is `docs.localhost`.
const SITE = {
  id: "e2e-home-demo-site",
  slug: "e2e-home-demo",
  name: "Home Demo Docs",
  customDomain: "docs.localhost",
};
let widgetId: string;

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();
  await sql`delete from site where id = ${SITE.id}`;
  // Another spec may hold this custom domain from an earlier run; it's unique in practice but
  // not by constraint, and a leftover row would shadow ours.
  await sql`delete from site where custom_domain = ${SITE.customDomain} and id <> ${SITE.id}`;
  widgetId = `widget_e2e_home_${Date.now()}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status,
                             custom_domain, custom_domain_verified_at,
                             widget_id, widget_enabled, widget_allowed_origins)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live',
                    ${SITE.customDomain}, now(),
                    ${widgetId}, true, ${sql.json([HOME_ORIGIN])})`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  // Leave no counters behind for the next run — the limiter's window outlives this file.
  await sql`delete from rate_limit where key like ${`widget:${widgetId}%`}`;
  await sql.end();
});

test("the frame reads a live docs site, and Edit swaps the same frame to the editor", async ({
  page,
}) => {
  await page.goto(HOME_ORIGIN);

  // Read mode frames a real Papervine-rendered site. The iframe is only rendered once the
  // section scrolls into view — a third-party document is the heaviest thing on this page, and
  // loading it for visitors who never leave the hero would undo the rest of the care here.
  const frame = page.locator('iframe[title="A documentation site rendered by Papervine"]');
  await expect(frame).toHaveCount(0);

  await page.getByRole("button", { name: "Edit this page" }).scrollIntoViewIfNeeded();
  await expect(frame).toHaveCount(1, { timeout: 10_000 });
  // It points at a real docs page, not a placeholder.
  await expect(frame).toHaveAttribute("src", /\/quickstart$/);

  // Edit replaces what the frame shows without unmounting the iframe (re-mounting would
  // re-download the site on every toggle, and would throw away anything typed).
  await page.getByRole("button", { name: "Edit this page" }).click();
  await expect(page.locator(".pv-visual .ProseMirror")).toBeVisible({ timeout: 15_000 });
  await expect(frame).toHaveCount(1);

  await page.getByRole("button", { name: "Read" }).click();
  await expect(page.locator(".pv-visual .ProseMirror")).toBeHidden();
});

test("the editor demo mounts on intent and edits a real MDX file, console-clean", async ({
  page,
}) => {
  // The durable regression gate for this surface: a flushSync-during-render or an update loop
  // inside TipTap is invisible in the DOM and in a screenshot, and shows up only here.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  await page.goto(HOME_ORIGIN);

  // Nothing TipTap-related before the click — the whole point of the poster frame is that the
  // editor's chunk isn't on the critical path of the SEO landing.
  await expect(page.locator(".pv-visual .ProseMirror")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit this page" }).click();
  const editor = page.locator(".pv-visual .ProseMirror");
  await expect(editor).toBeVisible({ timeout: 15_000 });

  // The source pane is a read-only CodeMirror view, which renders only the lines in its
  // viewport — so these assertions must target content near the TOP of the document. A check
  // for something far down the file would fail on a document CodeMirror hasn't painted yet,
  // which looks like the editor not emitting rather than the pane not scrolling.
  const source = page.getByTestId("home-demo-source");
  await expect(source).toContainText("title: \"Quickstart\"");
  await expect(source).not.toContainText("<Note>\n  Inserted");

  // Type into the document and watch it become MDX. This is the demo's entire claim.
  await editor.getByText("Every page on your docs site").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Typed by a test.");
  await expect(source).toContainText("Typed by a test.");

  // The `/` palette, which is what the header tells visitors to press.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/note");
  const menu = page.locator(".pv-slash-menu");
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press("Enter");
  await expect(source).toContainText("<Note>");

  // Reset restores the original document.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(source).not.toContainText("Typed by a test.");

  const reactErrors = errors.filter(
    (e) =>
      e.startsWith("pageerror:") ||
      /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
  );
  expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
});

test("the demo editor offers no media blocks, since it has no site behind it", async ({ page }) => {
  // /image, /video and /embed open a dialog backed by server actions against a site's object
  // storage. There is no site here, so they must not be reachable — a visitor who found one
  // would hit a dead end on the page we most want to be convincing.
  await page.goto(HOME_ORIGIN);
  await page.getByRole("button", { name: "Edit this page" }).click();
  const editor = page.locator(".pv-visual .ProseMirror");
  await expect(editor).toBeVisible({ timeout: 15_000 });

  await editor.getByText("Every page on your docs site").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  // The menu either doesn't open or reports nothing — what matters is that no Image item exists.
  await expect(page.locator(".pv-slash-item", { hasText: "Image" })).toHaveCount(0);

  // Mermaid is categorised as Media but needs no storage, so it must SURVIVE the filter —
  // this is the assertion that keeps the predicate keyed on `input` rather than on category.
  await page.keyboard.press("Escape");
  for (let i = 0; i < "/image".length; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type("/mermaid");
  await expect(page.locator(".pv-slash-item", { hasText: "Mermaid" })).toBeVisible({
    timeout: 5_000,
  });
});

test("an Ask chip opens the widget and asks the question", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(HOME_ORIGIN);

  // With a demo site resolved, the chips are buttons that drive the widget (they degrade to
  // plain links when it isn't — that fallback is covered by the smoke gate).
  const chip = page.getByRole("button", { name: /migrate an existing docs.json site/i });
  await chip.click();

  // Playwright pierces shadow DOM, so the widget's own UI is addressable.
  await expect(page.locator(".pv-panel.open")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".pv-msg.user")).toContainText("migrate");
  // Whether a real answer streams depends on an AI provider being configured in this
  // environment; a graceful "unavailable" bubble is an equally valid outcome. What must NOT
  // happen is an uncaught error.
  await expect(page.locator(".pv-msg.assistant, .pv-msg.error").first()).not.toBeEmpty({
    timeout: 30_000,
  });
  expect(errors, `unexpected page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("the widget chat endpoint rate limits one visitor", async ({ request }) => {
  // The limiter runs BEFORE the provider check precisely so this is observable with no AI
  // configured (the state CI runs in) — otherwise every request would 503 and the 429 would
  // never be reached.
  const url = `${HOME_ORIGIN}/api/widget/${widgetId}/chat`;
  const body = {
    messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
  };

  // CONCURRENTLY, for two reasons. Every request the limiter *allows* runs a real assistant turn
  // wherever an AI provider is configured, so firing 22 in series costs the sum of 22 model calls
  // — that blew the 30s budget in a full-suite run, while passing alone only because nothing was
  // configured at the time. In parallel the whole thing costs about one call's latency.
  //
  // It also exercises the property the store is built for: the increment is a single atomic
  // upsert precisely so simultaneous requests from one client can't both read `count: 19` and
  // both be allowed. Serial requests never test that.
  const attempts = ASSISTANT_POLICY.limit + 2;
  const responses = await Promise.all(
    Array.from({ length: attempts }, () =>
      request.post(url, { headers: { Origin: HOME_ORIGIN }, data: body }),
    ),
  );

  const limited = responses.filter((r) => r.status() === 429);
  expect(
    limited.length,
    `expected at least one 429 across ${attempts} concurrent requests (statuses: ${responses
      .map((r) => r.status())
      .join(",")})`,
  ).toBeGreaterThan(0);
  // The cooldown must be readable cross-origin, which needs Retry-After on Expose-Headers.
  expect(Number(limited[0].headers()["retry-after"])).toBeGreaterThan(0);
});
