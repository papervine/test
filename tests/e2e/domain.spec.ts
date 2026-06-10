import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";

// Domain setup (SPEC §2): an owner maps a vanity host to the active site and serves it
// at the root or under /docs. Deterministic — seeds a site under the seeded org (no
// GitHub/MinIO) and pins it active via the pv_site cookie, so it runs in CI. The live
// "Connected" check fetches the (unreachable) test domain and stays Pending, which is
// exactly the not-yet-pointed-DNS state we assert.
const SITE = { id: "e2e-domain-site", slug: "e2e-domain", name: "Domain E2E" };
const DOMAIN = "docs.e2e-domain.test";

test.describe("custom domain setup", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization limit 1`;
    expect(org, "expected a seeded organization").toBeTruthy();
    await sql`delete from site where id = ${SITE.id}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
              values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  });

  test.afterAll(async () => {
    await sql`delete from site where id = ${SITE.id}`;
    await sql.end();
  });

  test("connects a domain, persists it, and toggles /docs hosting", async ({
    page,
    context,
    baseURL,
  }) => {
    // Pin this site active regardless of what else is seeded.
    await context.addCookies([
      { name: "pv_site", value: SITE.slug, url: baseURL! },
    ]);

    await page.goto("/dashboard/settings/domain");
    await expect(
      page.getByRole("heading", { name: "Set up your custom domain" }),
    ).toBeVisible();

    // Enter a domain and connect it.
    await page.getByPlaceholder("docs.acme.com").fill(DOMAIN);
    await page.getByRole("button", { name: "Connect domain" }).click();

    // It persists: the value sticks, and the (unreachable) domain shows Pending DNS
    // with the CNAME instructions — the not-yet-pointed state.
    await expect(page.getByText("Pending DNS")).toBeVisible();
    await expect(page.getByRole("button", { name: "Update domain" })).toBeVisible();
    await expect(page.getByText("Point your DNS here")).toBeVisible();

    // Poll the DB rather than reading once: each save blocks on a ~5s live check, so the
    // row settles slightly after the UI does. (The "Update domain" badge alone can't gate
    // the second save — Pending DNS is already on screen from the first.)
    const subpathOf = async () => {
      const [r] = await sql`select custom_domain, custom_domain_subpath
                            from site where id = ${SITE.id}`;
      expect(r.custom_domain).toBe(DOMAIN);
      return r.custom_domain_subpath as boolean;
    };
    await expect.poll(subpathOf).toBe(false);

    // Flip "Host at /docs" on and re-save — the flag persists.
    await page.getByRole("switch", { name: "Host at /docs" }).click();
    await page.getByRole("button", { name: "Update domain" }).click();
    await expect.poll(subpathOf).toBe(true);

    // Remove clears it.
    await page.getByRole("button", { name: "Remove domain" }).click();
    await expect(page.getByPlaceholder("docs.acme.com")).toHaveValue("");
    await expect
      .poll(async () => {
        const [r] = await sql`select custom_domain from site where id = ${SITE.id}`;
        return r.custom_domain;
      })
      .toBeNull();
  });
});
