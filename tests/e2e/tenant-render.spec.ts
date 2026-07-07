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

    const res = await page.request.get(`/api/tenant-asset/${SLUG}/logo.svg`);
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
    const res = await page.request.get(`/api/search?q=zorptenant&site=${SLUG}`);
    expect(res.status()).toBe(200);
    const hrefs = ((await res.json()).results ?? []).map((r: { href: string }) => r.href);
    expect(hrefs).toContain("/index");

    // And a platform-only term must NOT leak in (the tenant has no such page).
    const leak = await page.request.get(`/api/search?q=Papervine&site=${SLUG}`);
    expect(((await leak.json()).results ?? []).length).toBe(0);
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
