import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { ORG_SLUG } from "./constants";

// Billing settings (SPEC §10 Billing). Billing is org-level but its surfaces live under
// site Settings — /:org/:site/settings/billing (plan) + /settings/usage (credits).
// Deterministic (no Stripe): the auth.setup org is put on the 30-day trial via a
// backfill mirroring the afterCreateOrganization hook, against a catalog this spec seeds
// (so it never depends on billing:sync having run on papervine_test).
//
// Console-clean assertion follows the editor.spec.ts pattern: these render client
// components (checkout buttons, overage switch) whose failure mode is a React console
// error, invisible to DOM assertions.

const sql = postgres(TEST_DB_URL, { max: 1 });
const SITE = "billing-e2e"; // seeded site slug; the settings surfaces hang under it
const billingPath = `/${ORG_SLUG}/${SITE}/settings/billing`;
const usagePath = `/${ORG_SLUG}/${SITE}/settings/usage`;

test.describe("billing settings", () => {
  test.beforeAll(async () => {
    // Minimal catalog: trial + free + one paid plan with a price, mirroring what
    // billing:sync publishes from catalog.json. Idempotent (unique keys).
    const ents = (ai: boolean) =>
      JSON.stringify({
        sites: ai ? 10 : 1,
        editors: ai ? 25 : 3,
        analyticsRetentionDays: ai ? 365 : 7,
        features: {
          assistant: ai, writerAgent: ai, workflows: ai, sso: ai, rbac: ai,
          previewDeployments: ai, adminApis: ai, advancedInsights: ai,
          multiRepo: ai, scim: false,
        },
      });
    for (const [key, name, listed, sort, credits] of [
      ["free", "Free", true, 0, 0],
      ["team", "Team", true, 1, 5000],
      ["pro", "Pro", true, 2, 25000],
      ["trial", "Trial", false, 99, 0],
    ] as const) {
      await sql`insert into billing_plan (key, name, listed, sort) values (${key}, ${name}, ${listed}, ${sort})
                on conflict (key) do nothing`;
      await sql`insert into billing_plan_version (id, plan_key, version, entitlements, included_monthly_credits, config_hash)
                values (${`bpv-${key}-e2e`}, ${key}, 1, ${ents(key !== "free")}::jsonb, ${credits}, ${"e2e"})
                on conflict do nothing`;
    }
    // Team + Pro need a published price to render as change-plan cards.
    await sql`insert into billing_price (id, plan_key, interval, unit_amount_cents)
              values ('bp-team-month-e2e', 'team', 'month', 5000) on conflict do nothing`;
    await sql`insert into billing_price (id, plan_key, interval, unit_amount_cents)
              values ('bp-pro-month-e2e', 'pro', 'month', 30000) on conflict do nothing`;

    // Backfill the trial the signup hook would have written.
    const [org] = await sql`select id from organization where slug = ${ORG_SLUG}`;
    expect(org, "expected the auth.setup org").toBeTruthy();
    const ends = new Date(Date.now() + 30 * 86_400_000);
    await sql`insert into billing_subscription (organization_id, plan_version_id, status, trial_ends_at)
              values (${org.id}, 'bpv-trial-e2e', 'trialing', ${ends})
              on conflict (organization_id) do update set
                plan_version_id = 'bpv-trial-e2e', status = 'trialing', trial_ends_at = ${ends},
                cancel_at_period_end = false, current_period_end = null`;
    await sql`insert into credit_balance (organization_id, trial_credits)
              values (${org.id}, 5000)
              on conflict (organization_id) do update set trial_credits = 5000, monthly_credits = 0`;

    // The settings surfaces live under a site, and the rail's per-site nav (Automate
    // items + their Trialing pills) needs a site to render. Content isn't needed.
    await sql`insert into site (id, organization_id, name, slug, branch, status)
              values ('billing-e2e-site', ${org.id}, 'Billing E2E', ${SITE}, 'main', 'live')
              on conflict (id) do nothing`;
  });

  test.afterAll(async () => {
    await sql`delete from site where id = 'billing-e2e-site'`;
    await sql.end();
  });

  test("billing surface: trial state + change-plan cards, clean console", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(billingPath);

    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    await expect(page.getByText(/Trial — \d+ days? left/)).toBeVisible();
    // Change-plan card with its price (button exists; clicking needs Stripe).
    await expect(page.getByRole("heading", { name: "Plans", exact: true })).toBeVisible();
    await expect(page.getByText("$50")).toBeVisible();
    // Feature bullets on the cards + the shared comparison matrix (same content as
    // /pricing, via the reused PlanMatrix component).
    await expect(page.getByText("SSO & RBAC")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compare plans" })).toBeVisible();
    await expect(page.getByText("Docs sites")).toBeVisible();
    // Mid-trial: the tier the trial samples (Pro) is badged "Trialing until <date>".
    await expect(page.getByText(/Trialing until/)).toBeVisible();

    expect(errors, `billing console must stay clean:\n${errors.join("\n")}`).toEqual([]);
  });

  test("usage surface: credit meter with remaining semantics + reset date, clean console", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(usagePath);

    await expect(page.getByRole("heading", { name: "Usage", exact: true })).toBeVisible();
    // REMAINING semantics spelled out — a full bar of remaining credits once read as
    // "all used up" (real user report), so the labels must stay explicit.
    await expect(page.getByText("AI credits", { exact: true })).toBeVisible();
    await expect(page.getByText("remaining")).toBeVisible();
    await expect(page.getByText(/5,000\s*left/)).toBeVisible();
    // Reset date (competitor parity): the trial shows when it ends.
    await expect(page.getByText("Trial ends")).toBeVisible();
    // Overage switch (client component mounted without hydration issues).
    await expect(page.getByRole("switch")).toBeVisible();

    expect(errors, `usage console must stay clean:\n${errors.join("\n")}`).toEqual([]);
  });

  test("settings nav has Billing + Usage, and the rail badges trial-gated items", async ({
    page,
  }) => {
    await page.goto(billingPath);
    // The Settings subnav (Workspace section) exposes both surfaces.
    await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usage" })).toBeVisible();
    // Mid-trial → the AppRail's AI items carry "Trialing" pills (Workflows·Agent·Assistant).
    await expect(page.getByText("Trialing").first()).toBeVisible();
    expect(await page.getByText("Trialing").count()).toBeGreaterThanOrEqual(3);
  });

  test("org-level /:org/billing redirects to the settings surface", async ({ page }) => {
    await page.goto(`/${ORG_SLUG}/billing`);
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/${SITE}/settings/billing$`));
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
  });

  test("downgrade to Free and resume (non-Stripe subscription path)", async ({ page }) => {
    // Put the org on a non-Stripe active paid plan (the seed/support-granted shape).
    const [org] = await sql`select id from organization where slug = ${ORG_SLUG}`;
    const periodEnd = new Date(Date.now() + 20 * 86_400_000);
    await sql`update billing_subscription set status = 'active', trial_ends_at = null,
              stripe_subscription_id = null, cancel_at_period_end = false,
              current_period_start = now(), current_period_end = ${periodEnd}
              where organization_id = ${org.id}`;

    await page.goto(billingPath);
    await expect(page.getByText(/Renews /)).toBeVisible();

    await page.getByRole("button", { name: "Downgrade to Free" }).click();
    await page.getByRole("button", { name: "Confirm downgrade" }).click();
    await expect(page.getByText(/Downgrades to Free on /)).toBeVisible();
    await expect(page.getByText(/Cancels /)).toBeVisible();
    const [afterCancel] = await sql`select cancel_at_period_end from billing_subscription
                                    where organization_id = ${org.id}`;
    expect(afterCancel.cancel_at_period_end).toBe(true);

    await page.getByRole("button", { name: "Resume plan" }).click();
    await expect(page.getByText(/Renews /)).toBeVisible();
    // After resume the control must return to the initial "Downgrade to Free" state —
    // NOT the mid-confirm "Confirm downgrade" (the `confirming` flag leaked across the
    // refresh and stuck the button on the confirm step; regression guard).
    await expect(page.getByRole("button", { name: "Downgrade to Free" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm downgrade" })).toHaveCount(0);
    const [afterResume] = await sql`select cancel_at_period_end from billing_subscription
                                    where organization_id = ${org.id}`;
    expect(afterResume.cancel_at_period_end).toBe(false);

    // Restore the trial state the other tests assume.
    const ends = new Date(Date.now() + 30 * 86_400_000);
    await sql`update billing_subscription set plan_version_id = 'bpv-trial-e2e',
              status = 'trialing', trial_ends_at = ${ends}, cancel_at_period_end = false,
              current_period_start = null, current_period_end = null
              where organization_id = ${org.id}`;
  });
});
