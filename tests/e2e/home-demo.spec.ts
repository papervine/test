import { test, expect, request as apiRequest } from "@playwright/test";
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
  // Hooks carry their OWN 30s budget, independent of `test.slow()` on the tests below — and the
  // warm-up at the end of this hook deliberately triggers two on-demand route compiles, which
  // on CI exceeded that and failed the hook (reported against the first test, at 0ms). Called
  // inside beforeAll, `setTimeout` raises the HOOK's budget, which is the one that matters here.
  test.setTimeout(180_000);

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

  // Warm the two widget routes this file is the FIRST visitor to. Under `next dev` each route
  // compiles on demand, and on CI (~4× slower than a dev machine) that first compile alone can
  // outlast a test's 30s budget — which is what failed the chip spec twice while it passed
  // locally, the same shape as the widget-settings cold-compile story in CLAUDE.md. Warming
  // here moves the compile off the assertion path instead of papering over it with timeouts.
  //
  // The chat POST carries NO Origin header on purpose: that returns 403 at the allowlist check,
  // which sits *before* the rate limiter, so warming the route costs none of the quota the
  // limit test later depends on.
  const warm = await apiRequest.newContext();
  await warm.get(`${HOME_ORIGIN}/api/widget/embed.js`).catch(() => {});
  await warm.post(`${HOME_ORIGIN}/api/widget/${widgetId}/chat`, { data: {} }).catch(() => {});
  await warm.dispose();
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

  // Read mode frames a real Papervine-rendered site.
  //
  // Deliberately NOT asserting the iframe is absent before scrolling. It IS lazily mounted (an
  // IntersectionObserver with a 200px margin), but the demo now sits just under the hero, so at
  // most viewport heights the observer fires on load and the count is legitimately 1 straight
  // away — an assertion that depended on the section being below the fold raced against the
  // page's own layout. The guarantee worth pinning is that the *editor chunk* isn't on the
  // critical path, which the next test asserts off a click rather than a scroll position.
  const frame = page.locator('iframe[title="A documentation site rendered by Papervine"]');

  await page.getByRole("button", { name: "Edit this page" }).scrollIntoViewIfNeeded();
  await expect(frame).toHaveCount(1, { timeout: 10_000 });
  // It points at the framed site's INDEX. Pinned because an earlier cut appended a guessed
  // `/quickstart`, which exists on the starter example but not on our own documentation — so in
  // production the demo framed the renderer's "Page not found". Only the index is guaranteed to
  // exist on every site, which is why the resolver must never append a page here.
  await expect(frame).toHaveAttribute("src", /^https?:\/\/[^/]+(\/|\/sites\/[^/]+)$/);

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
  // Mounting a shadow-root widget and streaming a first answer is genuinely slow on CI even
  // with the routes warmed, and the default 30s budget leaves no room for the panel wait.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(HOME_ORIGIN);

  // With a demo site resolved, the chips are buttons that drive the widget (they degrade to
  // plain links when it isn't — that fallback is covered by the smoke gate).
  const chip = page.getByRole("button", { name: /migrate an existing docs.json site/i });
  // Explicit headroom on the first interactions: `test.slow()` raises the TEST budget but not
  // the 5s per-assertion default, and the routes being warm doesn't make a cold CI runner fast.
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await chip.scrollIntoViewIfNeeded();
  await chip.click();

  // Playwright pierces shadow DOM, so the widget's own UI is addressable.
  await expect(page.locator(".pv-panel.open")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".pv-msg.user")).toContainText("migrate");
  // Whether a real answer streams depends on an AI provider being configured in this
  // environment; a graceful "unavailable" bubble is an equally valid outcome. What must NOT
  // happen is an uncaught error.
  await expect(page.locator(".pv-msg.assistant, .pv-msg.error").first()).not.toBeEmpty({
    timeout: 45_000,
  });
  expect(errors, `unexpected page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("the widget chat endpoint rate limits one visitor", async ({ request }) => {
  // 22 concurrent requests against a dev server: fast once warm, but it flaked on CI at the
  // default budget (failed, then passed on retry) before the beforeAll warm-up existed.
  test.slow();
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
