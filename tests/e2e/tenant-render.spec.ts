import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { TEST_DB_URL } from "./global-setup";
import { APEX_ORIGIN } from "./constants";

// Tenant docs serve on the apex (path mode), but baseURL is the app host (SPEC §10), so
// address them absolutely.
const docsUrl = (p: string) => `${APEX_ORIGIN}${p}`;

// Regression: a tenant's docs must render from ITS content, not the platform's default
// content/ repo. The root layout reads config before any route sets contentContext;
// if it primes React's per-request cache() with the default config, the tenant page
// renders the platform's nav (e.g. content/'s "Writing Docs → guides/markdown") while
// serving the tenant's pages — so those bogus links 404. (Fixed via requestContentSource.)
//
// Deterministic (no GitHub): seed a site row + synced content straight into Postgres
// and MinIO, then read it back via apex path-mode (/sites/{slug}). Runs in CI.

const SITE_ID = "e2e-tenant-render-site";
const SLUG = "regression-nav";

// A second tenant identical to the first but with the assistant kill switch OFF
// (assistant_enabled=false), to prove the disabled state hides the launcher (SPEC §8.6).
const NOASSIST_SITE_ID = "e2e-tenant-render-noassist";
const NOASSIST_SLUG = "regression-no-assistant";

// Distinctive nav that exists ONLY in this tenant's repo — nothing the platform's
// content/ docs.json contains — so a leak from the default source is unmistakable.
const DOCS_JSON = JSON.stringify({
  name: "Regression Tenant",
  colors: { primary: "#2563EB" },
  // Root-absolute logo path (a comparable hosted docs platform convention) — must resolve to our tenant-asset
  // route, NOT GitHub. This is the shape that broke the navbar logo on live-GitHub sites.
  logo: "/logo.svg",
  navigation: {
    tabs: [{ tab: "Docs", groups: [{ group: "Tenant Only Group", pages: ["index", "tenant-page"] }] }],
  },
});

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="28"><rect width="100" height="28" fill="#2563EB"/></svg>`;

const s3 = new S3Client({
  region: "auto",
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
  credentials: { accessKeyId: "papervine", secretAccessKey: "papervinesecret" },
});

async function put(key: string, body: string, contentType = "text/plain") {
  await s3.send(
    new PutObjectCommand({ Bucket: "papervine-content", Key: key, Body: body, ContentType: contentType }),
  );
}

test.describe("tenant docs render from the tenant's own content @external", () => {
  // @external: needs MinIO (object storage). CI's e2e job has Postgres but not MinIO,
  // so it skips this with --grep-invert @external; run locally with docker compose up.
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    // A site needs an org; reuse the one auth.setup created via onboarding.
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();

    await sql`delete from site where id = ${SITE_ID}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
              values (${SITE_ID}, ${org.id}, 'Regression Tenant', ${SLUG}, 'acme', 'docs', 'main', 'live')`;

    const prefix = `sites/${SITE_ID}/`;
    await put(`${prefix}docs.json`, DOCS_JSON);
    // `zorptenant` is a nonsense token that exists ONLY in this tenant's content, so a
    // search hit for it proves the index was built from the tenant — not the platform.
    await put(`${prefix}index.mdx`, `---\ntitle: Tenant Home\n---\nTENANT_HOME_MARKER zorptenant\n`);
    await put(`${prefix}tenant-page.mdx`, `---\ntitle: Tenant Page\n---\nTENANT_PAGE_MARKER\n`);
    await put(`${prefix}logo.svg`, LOGO_SVG, "image/svg+xml");
    // A pair for the layout-stability test below: one page far taller than the viewport
    // and one only a line long. Neither is in docs.json's nav (both are reached by URL),
    // so they don't disturb the sidebar assertions above.
    const longBody = Array.from(
      { length: 60 },
      (_, i) => `## Section ${i}\n\nParagraph ${i} — filler to push this page past the viewport.\n`,
    ).join("\n");
    await put(`${prefix}long.mdx`, `---\ntitle: Long\n---\nLONG_MARKER\n\n${longBody}`);
    await put(`${prefix}stub.mdx`, `---\ntitle: Stub\n---\nSTUB_MARKER\n`);

    // The assistant-disabled twin: same content, assistant_enabled=false.
    await sql`delete from site where id = ${NOASSIST_SITE_ID}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status, assistant_enabled)
              values (${NOASSIST_SITE_ID}, ${org.id}, 'No Assistant Tenant', ${NOASSIST_SLUG}, 'acme', 'docs', 'main', 'live', false)`;
    const nprefix = `sites/${NOASSIST_SITE_ID}/`;
    await put(`${nprefix}docs.json`, DOCS_JSON);
    await put(`${nprefix}index.mdx`, `---\ntitle: Tenant Home\n---\nNOASSIST_HOME_MARKER\n`);
    await put(`${nprefix}tenant-page.mdx`, `---\ntitle: Tenant Page\n---\nTENANT_PAGE_MARKER\n`);
    await put(`${nprefix}logo.svg`, LOGO_SVG, "image/svg+xml");
  });

  test.afterAll(async () => {
    await sql`delete from site where id in (${SITE_ID}, ${NOASSIST_SITE_ID})`;
    await sql.end();
  });

  test("sidebar comes from the tenant repo, not the platform default", async ({ page }) => {
    await page.goto(docsUrl(`/sites/${SLUG}`));

    // The tenant's own group/page renders…
    await expect(page.getByText("TENANT_HOME_MARKER")).toBeVisible();
    await expect(page.getByRole("link", { name: "Tenant Page" })).toBeVisible();

    // …and the platform content/ nav ("Writing Docs" → Markdown/Components) does NOT leak in.
    await expect(page.getByRole("link", { name: "Markdown" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Components" })).toHaveCount(0);
  });

  test("the navbar logo is served from our object storage, not GitHub", async ({ page }) => {
    // Regression: docs.json declares a root-absolute logo (`/logo.svg`). On a live-GitHub
    // site that path 404'd because the tenant-asset route only reads object storage. Now
    // everything is synced to us, so the logo must resolve through /api/tenant-asset/{slug}.
    await page.goto(docsUrl(`/sites/${SLUG}`));
    const logo = page.getByAltText("Regression Tenant");
    await expect(logo).toHaveCount(1);
    await expect(logo).toHaveAttribute("src", `/api/tenant-asset/${SLUG}/logo.svg`);

    // docsUrl(), not a relative path: `page.request` is Node-side, and a relative URL
    // resolves against baseURL — the app host — which Node's DNS can't resolve
    // (`ENOTFOUND app.localhost`; only the browser maps *.localhost). The apex origin is
    // 127.0.0.1, per the repo's fetch-127.0.0.1-not-localhost rule.
    const res = await page.request.get(docsUrl(`/api/tenant-asset/${SLUG}/logo.svg`));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
  });

  test("the navbar's Ask Assistant button opens the assistant drawer", async ({ page }) => {
    // Regression: the navbar (and its Ask Assistant button) renders on tenant pages, but
    // the <Assistant /> listener lives in the (docs)-group layout, which does NOT wrap the
    // /sites/{slug} route. Without mounting it on the tenant page, the button dispatched an
    // event nobody listened for — clicking did nothing.
    await page.goto(docsUrl(`/sites/${SLUG}`));
    await page.getByRole("button", { name: "Ask Assistant" }).click();
    await expect(
      page.getByText("Responses are generated using AI and may contain mistakes."),
    ).toBeVisible();
  });

  test("a site with the assistant disabled hides the Ask Assistant launcher (kill switch)", async ({
    page,
  }) => {
    // SPEC §8.6: the Assistant Status toggle is an operational kill switch. With it OFF the
    // docs still render, but the launcher (and its widget) must not mount — the bug where
    // the button kept showing on prod after disabling the assistant.
    await page.goto(docsUrl(`/sites/${NOASSIST_SLUG}`));
    await expect(page.getByText("NOASSIST_HOME_MARKER")).toBeVisible(); // page renders fine
    await expect(page.getByRole("button", { name: "Ask Assistant" })).toHaveCount(0);
  });

  test("search is scoped to the tenant, not the platform default", async ({ page }) => {
    // Regression: /api/search runs on the apex host (middleware doesn't rewrite /api/*),
    // so in path mode it can't infer the tenant from the Host header. Without the explicit
    // `site` param + contentContext, runSearch fell back to the platform content/ repo and
    // the tenant's Cmd-K (and the assistant's searchDocs) returned OUR pages. The client
    // passes ?site={slug}; assert the index is the tenant's by matching its unique token.
    // Absolute (see the logo test): a relative `page.request` URL resolves against the app
    // host, which Node's DNS can't resolve.
    const res = await page.request.get(docsUrl(`/api/search?q=zorptenant&site=${SLUG}`));
    expect(res.status()).toBe(200);
    const hrefs = ((await res.json()).results ?? []).map((r: { href: string }) => r.href);
    expect(hrefs).toContain("/index");

    // And a platform-only term must NOT leak in (the tenant has no such page).
    const leak = await page.request.get(docsUrl(`/api/search?q=Papervine&site=${SLUG}`));
    expect(((await leak.json()).results ?? []).length).toBe(0);
  });

  test("a short page lays out identically to a long one (no jump on nav)", async ({ page }) => {
    // Regression: clicking through the sidebar made the whole page twitch. One root cause,
    // two symptoms, both from the article column being shorter than the viewport:
    //
    //  • Horizontal — the document stopped overflowing, so the UA dropped the vertical
    //    scrollbar, widening the viewport by its width and sliding the centered
    //    `mx-auto max-w-7xl` shell sideways (then back). Fixed by `scrollbar-gutter:
    //    stable` on html (globals.css).
    //  • Vertical — the sidebar is `sticky top-28`, and a sticky element is clamped by its
    //    containing block. A short article collapsed the flex row, so the sidebar couldn't
    //    be pushed to its 7rem offset and rode ~47px higher. Fixed by ARTICLE_ROW's
    //    min-height (src/lib/docs-layout.ts), now shared by the article, the OpenAPI
    //    endpoint page, and the loading skeleton.
    //
    // Asserting on a genuinely short page rather than racing the loading skeleton keeps
    // this deterministic — it's the same collapsed row, just one that stays on screen.
    await page.setViewportSize({ width: 1280, height: 900 });

    // The SIDEBAR specifically — the element that rode up. `nav` alone would match the
    // top navbar, which is sticky to the viewport and never moved even when the bug was live.
    const sidebar = page
      .locator("nav")
      .filter({ has: page.getByRole("link", { name: "Tenant Page" }) });
    const measure = async () => {
      const box = await sidebar.boundingBox();
      return {
        x: Math.round(box!.x),
        y: Math.round(box!.y),
        clientWidth: await page.evaluate(() => document.documentElement.clientWidth),
      };
    };

    await page.goto(docsUrl(`/sites/${SLUG}/long`));
    await expect(page.getByText("LONG_MARKER")).toBeVisible();
    const long = await measure();

    await page.goto(docsUrl(`/sites/${SLUG}/stub`));
    await expect(page.getByText("STUB_MARKER")).toBeVisible();
    const short = await measure();

    // The sidebar must sit at the same offset on a one-line page as on a tall one.
    expect(short.y).toBe(long.y);
    // …and not slide sideways, which is the scrollbar-gutter half.
    expect(short.x).toBe(long.x);
    expect(short.clientWidth).toBe(long.clientWidth);
  });

  test("tenant pages resolve; platform-only pages 404 (no phantom links)", async ({ page }) => {
    const ok = await page.goto(docsUrl(`/sites/${SLUG}/tenant-page`));
    expect(ok?.status()).toBe(200);
    await expect(page.getByText("TENANT_PAGE_MARKER")).toBeVisible();

    // content/guides/markdown exists in the platform repo but not this tenant's — must 404,
    // and (per the sidebar assertion above) must never have been linked.
    const phantom = await page.goto(docsUrl(`/sites/${SLUG}/guides/markdown`));
    expect(phantom?.status()).toBe(404);
  });
});
