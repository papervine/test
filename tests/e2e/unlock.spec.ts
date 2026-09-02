import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { TEST_USER, sitePath } from "./constants";

// The self-host promise, pinned (SPEC §10 Billing; src/lib/billing/unlock.ts): an install with
// no billing backend never shows the "this feature comes with plan X" state on any surface —
// there is nothing to sell, so everything simply works. CI runs with no AUTUMN_SECRET_KEY, which
// is exactly that install. The locked branch itself is covered by billing-unlock.test.ts (pure)
// and by the sandbox in development; it cannot be produced here without a billing backend.
//
// Also a console-clean check for the four pages, since each now resolves billing before it
// renders — a thrown lookup would surface here first.

// Its own site, like the other specs that visit site-scoped routes: the e2e org is seeded with
// no sites, and a slug another spec seeds would make this pass only in file order.
const SITE = { id: `e2e-unlock-${randomUUID().slice(0, 8)}`, slug: "unlock-e2e", name: "Unlock E2E" };

const SURFACES = [
  ["automate/automations", "Automations"],
  ["automate/agent", "Agent"],
  ["automate/assistant", "Assistant"],
  ["settings/widget", "Embed the assistant on any site"],
] as const;

test.describe("plan-gated surfaces without a billing backend", () => {
  // Cold routes on whichever shard this lands on; four of them in one test.
  test.slow();

  test.beforeAll(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
    expect(org, "expected the onboarded org").toBeTruthy();
    await sql`delete from site where slug = ${SITE.slug}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
              values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
    await sql.end();
  });

  test.afterAll(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    await sql`delete from site where id = ${SITE.id}`;
    await sql.end();
  });

  test("render their real controls, never the unlock card, and stay console-clean", async ({
    page,
  }) => {
    test.skip(
      Boolean(process.env.AUTUMN_SECRET_KEY),
      "with a billing backend the seeded org's plan decides — this pins the no-backend rule",
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    for (const [sub, heading] of SURFACES) {
      const res = await page.goto(sitePath(SITE.slug, sub));
      expect(res?.status(), `${sub} should render, not 404`).toBe(200);
      // The visible page label (the Automate breadcrumb, or the settings h1) — not a heading
      // role: the Assistant page's headings are its metrics, and its name is only the crumb.
      await expect(page.getByText(heading, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("unlock-card")).toHaveCount(0);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
