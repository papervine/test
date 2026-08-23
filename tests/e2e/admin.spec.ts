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
  test.beforeEach(async ({ page }) => signInAsAdmin(page));

  test("/admin lists every customer org with members and totals", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Operator" }),
    ).toBeVisible();
    // The setup project's org + user appear even though the admin isn't a member.
    await expect(
      page.getByRole("heading", { name: TEST_USER.org }),
    ).toBeVisible();
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
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
    await page.goto("/admin");
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
    await expect(
      page.getByRole("heading", { name: "Operator" }),
    ).toBeVisible();
  });
});

// ---- platform-admin billing console: comp a plan for free ----

// The admin billing console (/admin/billing) lets support put an org on a paid plan for
// free — a NON-Stripe subscription + the plan's monthly credits. Uses a dedicated
// throwaway org (not ORG_SLUG) so it can't race billing.spec's mutations of that org.
test.describe("platform admin — plan comps", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const ORG_ID = "grant-e2e-org-id";
  const GRANT_SLUG = "grant-e2e-org";

  test.beforeAll(async () => {
    // Minimal catalog: a Team plan version with credits, mirroring billing:sync.
    await sql`insert into billing_plan (key, name, listed, sort) values ('team', 'Team', true, 1)
              on conflict (key) do nothing`;
    const ents = JSON.stringify({
      sites: 10, editors: 25, analyticsRetentionDays: 365,
      features: {
        assistant: true, writerAgent: true, workflows: true, sso: true, rbac: true,
        previewDeployments: true, adminApis: true, advancedInsights: true,
        multiRepo: true, scim: false,
      },
    });
    await sql`insert into billing_plan_version (id, plan_key, version, entitlements, included_monthly_credits, config_hash)
              values ('bpv-team-grant-e2e', 'team', 1, ${ents}::jsonb, 5000, 'e2e')
              on conflict do nothing`;
    // A standalone target org with no billing row — the comp is what puts it on a plan.
    await sql`insert into organization (id, name, slug, created_at)
              values (${ORG_ID}, 'Grant E2E', ${GRANT_SLUG}, now())
              on conflict (id) do nothing`;
    await sql`delete from billing_subscription where organization_id = ${ORG_ID}`;
    await sql`delete from credit_ledger where organization_id = ${ORG_ID}`;
    await sql`delete from credit_balance where organization_id = ${ORG_ID}`;
  });

  test.afterAll(async () => {
    await sql`delete from billing_subscription where organization_id = ${ORG_ID}`;
    await sql`delete from credit_ledger where organization_id = ${ORG_ID}`;
    await sql`delete from credit_balance where organization_id = ${ORG_ID}`;
    await sql`delete from organization where id = ${ORG_ID}`;
    await sql.end();
  });

  test.beforeEach(async ({ page }) => signInAsAdmin(page));

  test("grant Team for free → non-Stripe active subscription + monthly credits + audit trail", async ({
    page,
  }) => {
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { name: "Billing console" })).toBeVisible();

    // The Grant-plan form (first Organization/Reason on the page; the credit-adjustment
    // form below reuses those labels). Blank months = an indefinite comp.
    await page.getByLabel("Organization").first().selectOption(ORG_ID);
    await page.getByLabel("Plan").selectOption("team");
    await page.getByLabel("Reason").first().fill("e2e partner comp");
    await page.getByRole("button", { name: "Grant plan" }).click();
    await expect(page.getByText("Granted.")).toBeVisible();

    // A non-Stripe (comped) ACTIVE Team subscription, not scheduled to cancel.
    const [sub] = await sql`
      select s.status, s.stripe_subscription_id, s.cancel_at_period_end, s.current_period_end, v.plan_key
      from billing_subscription s
      join billing_plan_version v on v.id = s.plan_version_id
      where s.organization_id = ${ORG_ID}`;
    expect(sub?.plan_key).toBe("team");
    expect(sub?.status).toBe("active");
    expect(sub?.stripe_subscription_id).toBeNull();
    expect(sub?.cancel_at_period_end).toBe(false); // blank months → indefinite
    expect(sub?.current_period_end).toBeNull();

    // The plan's monthly credits, granted with the actor + reason on the ledger, cached.
    const [grant] = await sql`
      select delta, bucket, reason, actor_user_id from credit_ledger
      where organization_id = ${ORG_ID} and kind = 'grant_monthly'`;
    expect(grant?.delta).toBe(5000);
    expect(grant?.bucket).toBe("monthly");
    expect(grant?.reason).toBe("e2e partner comp");
    expect(grant?.actor_user_id).toBeTruthy();
    const [bal] = await sql`select monthly_credits from credit_balance where organization_id = ${ORG_ID}`;
    expect(bal?.monthly_credits).toBe(5000);
  });
});
