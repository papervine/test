import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";
import { TEST_USER, sitePath } from "./constants";

// Automate › Agent Slack banner (SPEC §10.2): the connected-workspace card used to
// keep Reinstall + Disconnect in a row at every width, which squeezed the title and
// the connected-to line into a leftover column on a phone. This spec seeds a
// slack_workspace row and asserts the phone-width geometry — copy uses the card
// width, actions sit under it — so that squeeze can't come back unnoticed.

const RUN = randomUUID().slice(0, 8);
const SITE = {
  id: `e2e-agent-${RUN}`,
  slug: `agent-e2e-${RUN}`,
  name: "Agent E2E",
};
const WORKSPACE = {
  id: `e2e-slack-${RUN}`,
  teamId: `T-E2E-${RUN}`,
  teamName: "Papervine",
};

test.describe("agent settings Slack banner", () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });

  test.beforeAll(async () => {
    const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
    expect(org, "expected the onboarded org").toBeTruthy();
    await sql`delete from site where slug = ${SITE.slug}`;
    await sql`delete from slack_workspace where team_id = ${WORKSPACE.teamId}`;
    await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
              values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
    // Dummy token — the settings page only reads team_name. Unique team_id so a
    // retry or a parallel shard can't collide with another run's workspace row.
    await sql`insert into slack_workspace
                (id, organization_id, team_id, team_name, bot_user_id, bot_token_enc, scopes)
              values (${WORKSPACE.id}, ${org.id}, ${WORKSPACE.teamId}, ${WORKSPACE.teamName},
                      'U-E2E', 'e2e-not-a-token', 'chat:write')`;
  });

  test.afterAll(async () => {
    await sql`delete from slack_workspace where id = ${WORKSPACE.id}`;
    await sql`delete from site where id = ${SITE.id}`;
    await sql.end();
  });

  test("stacks Reinstall/Disconnect under the copy on a phone-width viewport", async ({
    page,
  }) => {
    // Owns `automate/agent` in the connected state; cold-compile + first assertion
    // need the same headroom as the other specs that own a route.
    test.slow();
    await page.setViewportSize({ width: 390, height: 844 });

    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(sitePath(SITE.slug, "automate/agent"));
    await expect(page.getByRole("heading", { name: "Agent settings" })).toBeVisible({
      timeout: 60_000,
    });

    const card = page.getByTestId("slack-workspace-card");
    await expect(card.getByText("Slack workspace", { exact: true })).toBeVisible();
    await expect(card.getByText("Connected to Papervine.")).toBeVisible();

    const title = card.getByText("Slack workspace", { exact: true });
    const copy = card.getByText("Connected to Papervine.");
    const disconnect = card.getByRole("button", { name: "Disconnect" });

    const [cardBox, titleBox, copyBox, btnBox] = await Promise.all([
      card.boundingBox(),
      title.boundingBox(),
      copy.boundingBox(),
      disconnect.boundingBox(),
    ]);
    expect(cardBox, "slack card should be laid out").toBeTruthy();
    expect(titleBox, "title should be laid out").toBeTruthy();
    expect(copyBox, "connected-to copy should be laid out").toBeTruthy();
    expect(btnBox, "Disconnect should be laid out").toBeTruthy();

    // Title stays on one line once the actions are out of the row.
    expect(titleBox!.height).toBeLessThan(36);
    // Copy uses the card's content width, not a leftover column beside the actions.
    expect(copyBox!.width).toBeGreaterThan(cardBox!.width * 0.7);
    // Actions sit under the copy, not beside it.
    expect(btnBox!.y).toBeGreaterThanOrEqual(copyBox!.y + copyBox!.height - 2);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
