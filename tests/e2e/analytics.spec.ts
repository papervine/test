import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { test, expect } from "@playwright/test";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

const SITE_SLUG = "e2e-analytics";

// Seed a site + a handful of events straight into the test DB so the analytics page
// renders real aggregations (the only layer that exercises the DB→page path). The
// org was created by auth.setup.ts; we attach a site to it.
const SITE_ID = randomUUID();

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] =
    await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  if (!org) throw new Error(`test org "${TEST_USER.org}" not found`);

  await sql`delete from site where id = ${SITE_ID}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, status)
            values (${SITE_ID}, ${org.id}, 'E2E Docs', ${SITE_SLUG}, 'acme', 'docs', 'live')`;

  const A = randomUUID();
  const B = randomUUID();
  const G = randomUUID();
  const ev = (e: Record<string, unknown>) => ({
    id: randomUUID(),
    site_id: SITE_ID,
    source: "human",
    path: null,
    referrer: null,
    query: null,
    status: null,
    session_id: null,
    created_at: new Date(),
    ...e,
  });
  const rows = [
    // Humans: 3 views, 2 distinct visitors; '/' is the top page.
    ev({ type: "page_view", path: "/", referrer: "$direct", session_id: A }),
    ev({ type: "page_view", path: "/", referrer: "$direct", session_id: B }),
    ev({ type: "page_view", path: "/guide", referrer: "$direct", session_id: A }),
    ev({ type: "search", query: "roles", session_id: A }),
    ev({ type: "assistant", query: "how?", status: "answered", session_id: B }),
    // Agents: 2 views, 1 distinct visitor.
    ev({ type: "page_view", source: "agent", path: "/", referrer: "$direct", session_id: G }),
    ev({ type: "page_view", source: "agent", path: "/api", referrer: "$direct", session_id: G }),
  ];
  await sql`insert into analytics_event ${sql(rows)}`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE_ID}`; // cascades to events
  await sql.end();
});

test("analytics renders human metrics and the Top pages table", async ({ page }) => {
  await page.goto(sitePath(SITE_SLUG, "analytics"));

  const heading = page.getByRole("heading", { name: "Analytics" });
  await expect(heading).toBeVisible();
  // The active-site label sits next to the heading (the switcher also shows the name now,
  // so scope to the header to avoid a strict-mode double match).
  await expect(heading.locator("xpath=following-sibling::*[1]")).toHaveText("E2E Docs");

  // Humans is the default tab: 2 visitors, 3 views.
  await expect(page.getByTestId("metric-visitors")).toContainText("2");
  await expect(page.getByTestId("metric-views")).toContainText("3");
  await expect(page.getByTestId("metric-searches")).toContainText("1");
  await expect(page.getByTestId("metric-assistant")).toContainText("1");

  // Top pages lists '/'.
  const topPages = page.locator("section", { hasText: "Top pages" });
  await expect(topPages.getByText("/", { exact: true })).toBeVisible();
});

test("Agents view filters to agent-source data", async ({ page }) => {
  // Navigate straight to the agents tab — deterministic (no hydration race) and it
  // exercises the same server-side source=agent query the toggle drives.
  await page.goto(sitePath(SITE_SLUG, "analytics") + "?tab=agents");

  // Button text is "agents" (lowercase; capitalized via CSS), so match accordingly.
  await expect(page.getByRole("button", { name: "agents", exact: true })).toBeVisible();
  // The Agents tab shows Agent Visitors (distinct agent sessions) — 1 here, distinct from
  // the Humans tab's 2 visitors, proving the source=agent filtering.
  await expect(page.getByTestId("metric-visitors")).toContainText("1");
});
