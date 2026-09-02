import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { TEST_USER, ORG_SLUG } from "./constants";

// Platform superadmin (SPEC §10.10). The webServer env allowlists
// platform-admin@papervine.test (playwright.config.ts) — deliberately NOT the shared
// TEST_USER, who must stay a plain customer here to prove the negative cases.
const ADMIN = {
  name: "Platform Admin",
  email: "platform-admin@papervine.test",
  password: "e2e-admin-password-123",
};

// ---- as the regular customer (shared storageState from auth.setup) ----

test("a signed-in non-admin gets a 404 from /admin (invisible surface)", async ({
  page,
}) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("a non-admin's rail has no Platform Admin link", async ({ page }) => {
  await page.goto(`/${ORG_SLUG}/connect`);
  // Wait on the start-method chooser's radiogroup rather than its heading: the heading is
  // deliberately state-dependent ("Create your first site" vs "Add a site", SPEC §10.11) and
  // which one shows here depends on whether an earlier spec has created a site.
  await expect(page.getByRole("radiogroup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Platform Admin" })).toHaveCount(0);
});

// ---- as the platform admin (own session; no org membership at all) ----

// Sign the allowlisted admin in through the real UI. NOT page.request: that runs in
// Node, which can't resolve app.localhost (only Chromium maps *.localhost to loopback),
// and posting to 127.0.0.1 would set the session cookie on the wrong host. The first
// test of the suite run signs the account up (the DB is truncated per run); later tests
// hit "already exists" and fall back to sign-in. Either way an org-less user lands on
// /onboarding — /admin needs no org.
async function signInAsAdmin(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  const outcome = await Promise.race([
    page.waitForURL("**/onboarding").then(() => "signed-up"),
    page
      .getByText(/already exists/i)
      .waitFor()
      .then(() => "existing"),
  ]);
  if (outcome === "existing") {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/onboarding");
  }
}

test.describe("platform admin", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  // Nothing else in the suite visits /admin/*, so these tests pay the cold `next dev`
  // compile of every console route themselves — and each also signs in first, in a
  // beforeEach. On CI that lands at ~31s against the 30s default, which is why all five
  // failed on `main`'s own tip while passing locally. Same fix as widget-settings,
  // members-roles and domain: the budget, not the code, was wrong.
  test.slow();
  test.beforeEach(async ({ page }) => signInAsAdmin(page));

  // The console is list → detail now, not one page: /admin is counts and recent activity,
  // /admin/orgs is the table, and members live on an org's own page. Walking that path is also
  // the regression guard for the nav's active-tab match on a detail route.
  test("the console lists every customer org, and drills into one for its members", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.getByRole("link", { name: "Organizations" }).first().click();
    await expect(page.getByRole("heading", { name: "Organizations" })).toBeVisible();
    // The setup project's org appears even though the admin isn't a member of it.
    const orgLink = page.getByRole("link", { name: TEST_USER.org });
    await expect(orgLink).toBeVisible();

    await orgLink.click();
    await expect(page.getByRole("heading", { name: TEST_USER.org })).toBeVisible();
    // Members moved here from the old single page — this is where support actually looks.
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
  });

  test("every console section loads for an operator", async ({ page }) => {
    for (const [path, heading] of [
      ["/admin", "Overview"],
      ["/admin/orgs", "Organizations"],
      ["/admin/sites", "Sites"],
      ["/admin/deploys", "Deploys"],
      ["/admin/billing", "Billing"],
    ] as const) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} should render`).toBe(200);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("read-only bypass: a non-member admin can open any org's dashboard, marked by the banner", async ({
    page,
  }) => {
    await page.goto(`/${ORG_SLUG}`);
    await expect(page.getByText("Platform admin view")).toBeVisible();
    await expect(page.getByText(`you're not a member of`)).toBeVisible();
  });

  test("impersonate → browse as the customer → stop → back on /admin", async ({
    page,
  }) => {
    // Impersonate moved to the org's detail page, along with the member list.
    await page.goto("/admin/orgs");
    await page.getByRole("link", { name: TEST_USER.org }).click();
    // The admin belongs to no org, so every impersonate control targets a customer;
    // TEST_USER is the only member the setup created.
    await page.getByRole("button", { name: "impersonate" }).first().click();

    // The action hard-navigates to the customer's dashboard as them.
    await expect(page.getByText(`Impersonating ${TEST_USER.name}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Stop impersonating" }),
    ).toBeVisible();
    // Their world, not the admin's: the org-scoped shell resolved TEST_USER's org.
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}(/|$)`));

    // Retry the click+navigation as a unit: right after the impersonation hard-nav the
    // banner button can be visible before React hydrates its onClick — a click that
    // lands in that window silently no-ops.
    await expect(async () => {
      await page.getByRole("button", { name: "Stop impersonating" }).click();
      await page.waitForURL(/\/admin$/, { timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    // Stopping returns to /admin, which is the console's Overview.
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });
});

// ---- platform-admin billing console: comp a plan for free ----

// The admin billing console (/admin/billing) lets support put an org on a paid plan for
// free — a NON-Stripe subscription + the plan's monthly credits. Uses a dedicated
// throwaway org (not ORG_SLUG) so it can't race billing.spec's mutations of that org.
// Plan comps go to Autumn now, so the assertions that used to make this test worth having
// — a non-Stripe subscription row, a grant_monthly ledger entry with the actor and reason —
// are checking tables the comp path no longer writes. Rather than assert on a database that
// has stopped being the answer, this keeps the journey (operator fills the form, the comp is
// accepted) and skips without a billing backend to accept it.
//
// The audit trail that moved is called out in SPEC §10: Autumn records the grant, we no
// longer record who made it.
test.describe("platform admin — plan comps", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const ORG_ID = "grant-e2e-org-id";
  const GRANT_SLUG = "grant-e2e-org";
  const AUTUMN = Boolean(process.env.AUTUMN_SECRET_KEY);

  test.beforeAll(async () => {
    // The org is ours; its plan is Autumn's. Nothing else to seed.
    await sql`insert into organization (id, name, slug, created_at)
              values (${ORG_ID}, 'Grant E2E', ${GRANT_SLUG}, now())
              on conflict (id) do nothing`;
  });

  test.afterAll(async () => {
    await sql`delete from organization where id = ${ORG_ID}`;
    await sql.end();
  });

  test.beforeEach(async ({ page }) => signInAsAdmin(page));

  test("the console lists the Autumn catalog and accepts a comp", async ({ page }) => {
    test.skip(!AUTUMN, "needs a billing backend (AUTUMN_SECRET_KEY)");
    await page.goto("/admin/billing");
    // "Billing", not "Billing console": the page's heading now matches its nav label, since the
    // console's sidebar already says where you are.
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    // The catalog table is read straight from Autumn — an empty one means the key is wrong
    // or the environment has no plans, which is worth failing on rather than skipping past.
    await expect(page.getByText("No catalog —")).toHaveCount(0);

    // The Grant-plan form (first Organization/Reason on the page; the credit-adjustment
    // form below reuses those labels). Blank months = an indefinite comp.
    await page.getByLabel("Organization").first().selectOption(ORG_ID);
    await page.getByLabel("Plan").selectOption("team");
    await page.getByLabel("Reason").first().fill("e2e partner comp");
    await page.getByRole("button", { name: "Grant plan" }).click();
    await expect(page.getByText("Granted.")).toBeVisible();
  });
});
