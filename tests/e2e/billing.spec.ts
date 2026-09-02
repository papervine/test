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

// The chart's day columns are keyed by local day, the same way dayBuckets() keys them —
// a UTC key would slide a bar by one and the hover would miss.
const dayKeyLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const chartDays: string[] = [];

// Autumn is the billing source of truth (SPEC §10), so most of this file needs a real
// billing backend to talk to — it cannot be satisfied by seeding Postgres any more, and
// pointing CI at a live third party would make the suite non-deterministic and dependent
// on someone else's uptime.
//
// So these skip themselves without `AUTUMN_SECRET_KEY`, the same contract the collab
// remote-caret test uses for its optional service: run them locally against sandbox when
// you touch billing, and let CI cover the parts that are genuinely ours.
//
// What still runs everywhere is what still lives in our own database: the usage chart and
// the settings navigation. `usage_event` did not move to Autumn — it is the record of
// WHICH feature spent credits, and it is what the chart draws.
const AUTUMN = Boolean(process.env.AUTUMN_SECRET_KEY);

test.describe("billing settings", () => {
  test.beforeAll(async () => {
    // No catalog to seed any more. This file used to publish a miniature copy of
    // catalog.json into billing_plan / billing_plan_version / billing_price and backfill a
    // trial subscription, because Postgres was the billing source of truth. Autumn holds
    // that now, so seeding those tables would prove nothing — the surfaces read straight
    // past them. The billing-state tests skip instead (see AUTUMN above).
    //
    // What is still seeded is what is still ours: usage_event for the chart, and a site to
    // hang the settings routes off.
    const [org] = await sql`select id from organization where slug = ${ORG_SLUG}`;
    expect(org, "expected the auth.setup org").toBeTruthy();

    // Metered history for the usage chart: two days inside the 30-day window, split
    // 50/30/20 across the three features so the legend's percentages are exact rather
    // than "whatever the data happened to be". Only usage_event — the chart reads it
    // directly, and leaving the ledger/balance alone keeps the meter assertions above.
    await sql`delete from usage_event where organization_id = ${org.id}`;
    for (const back of [3, 2]) {
      const at = new Date();
      at.setDate(at.getDate() - back);
      at.setHours(12, 0, 0, 0);
      chartDays.push(dayKeyLocal(at));
      for (const [feature, credits] of [
        ["assistant", 1000],
        ["writer", 600],
        ["workflow", 400],
      ] as const) {
        await sql`insert into usage_event
                  (id, organization_id, feature, model, tokens_in, tokens_out, credits, rate_version, created_at)
                  values (${`ue-${back}-${feature}`}, ${org.id}, ${feature}, 'test-model',
                          ${credits * 90}, ${credits * 30}, ${credits}, 1, ${at})`;
      }
    }

    // The settings surfaces live under a site, and the rail's per-site nav (Automate
    // items + their Trialing pills) needs a site to render. Content isn't needed.
    await sql`insert into site (id, organization_id, name, slug, branch, status)
              values ('billing-e2e-site', ${org.id}, 'Billing E2E', ${SITE}, 'main', 'live')
              on conflict (id) do nothing`;
  });

  test.afterAll(async () => {
    await sql`delete from site where id = 'billing-e2e-site'`;
    await sql`delete from usage_event where id like 'ue-%'`;
    await sql.end();
  });

  test("billing surface: trial state + change-plan cards, clean console", async ({
    page,
  }) => {
    test.skip(!AUTUMN, "needs a billing backend (AUTUMN_SECRET_KEY)");
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
    await expect(page.getByText("$65")).toBeVisible();
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
    test.skip(!AUTUMN, "needs a billing backend (AUTUMN_SECRET_KEY)");
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

  test("usage chart: stacked days, legend totals, hover tooltip, clean console", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(usagePath);

    const chart = page.getByTestId("usage-chart");
    await expect(chart.getByRole("heading", { name: "Credit usage" })).toBeVisible();
    // 30 day columns whatever the data — the window is dense, not just the days with usage.
    await expect(chart.locator("[data-day]")).toHaveCount(30);

    // Legend: every series named with its total and its share (2K/1.2K/800 of 4K).
    const legend = page.getByTestId("usage-legend");
    await expect(legend).toContainText("Assistant");
    await expect(legend).toContainText("2K");
    await expect(legend).toContainText("50%");
    await expect(legend).toContainText("Editor agent");
    await expect(legend).toContainText("30%");
    await expect(legend).toContainText("Automations");
    await expect(legend).toContainText("20%");

    // Hovering a day opens the tooltip with THAT day's split (1K/600/400), not the total.
    await expect(page.getByTestId("usage-tooltip")).toHaveCount(0);
    await chart.locator(`[data-day="${chartDays[0]}"]`).hover();
    const tip = page.getByTestId("usage-tooltip");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("1K");
    await expect(tip).toContainText("600");
    await expect(tip).toContainText("400");

    // A day with no usage has no tooltip to show (and must not crash trying).
    const quiet = new Date();
    quiet.setDate(quiet.getDate() - 20);
    await chart.locator(`[data-day="${dayKeyLocal(quiet)}"]`).hover();
    await expect(page.getByTestId("usage-tooltip")).toHaveCount(0);

    expect(errors, `usage chart console must stay clean:\n${errors.join("\n")}`).toEqual(
      [],
    );
  });

  test("settings nav has Billing + Usage, and the rail badges trial-gated items", async ({
    page,
  }) => {
    // The nav links are ours; the "Trialing" badges are billing state.
    test.skip(!AUTUMN, "needs a billing backend (AUTUMN_SECRET_KEY)");
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

  // "downgrade to Free and resume" used to live here. It drove the flow by writing the
  // billing_subscription mirror directly (put the org on an active paid plan, click Downgrade,
  // read cancel_at_period_end back). That table is gone — Autumn holds subscription state —
  // and the honest replacement needs a paid plan attached in sandbox, which means Stripe
  // checkout. Cover it when the checkout path gets its own sandbox-only spec.

});
