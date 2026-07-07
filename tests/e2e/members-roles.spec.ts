import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_USER, sitePath } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// Settings → Members role management (SPEC §10): the invite form carries a role picker and
// an owner can re-role an existing member in place — the path that makes an org an eligible
// site-transfer destination (transfer requires owner/admin on both ends). We seed a site
// (routing context) and a second user as a `member`, then drive the real UI: change their
// role to admin (assert persisted), and send an owner-role invite (assert the invitation
// row carries it).
const SITE = { id: "e2e-members-site", slug: "members-roles-e2e", name: "Members Roles" };
const PEER = { id: "e2e-members-peer", email: "peer@papervine.test", name: "Peer User" };
const INVITEE = "invited-owner@papervine.test";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] = await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  expect(org, "expected the onboarded org").toBeTruthy();

  await sql`delete from site where id = ${SITE.id}`;
  await sql`delete from invitation where email = ${INVITEE}`;
  await sql`delete from "user" where id = ${PEER.id}`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, status)
            values (${SITE.id}, ${org.id}, ${SITE.name}, ${SITE.slug}, 'acme', 'docs', 'main', 'live')`;
  // A second account that's a plain `member` — no login needed, just the rows.
  await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
            values (${PEER.id}, ${PEER.name}, ${PEER.email}, true, now(), now())`;
  await sql`insert into member (id, organization_id, user_id, role, created_at)
            values (${`${PEER.id}-member`}, ${org.id}, ${PEER.id}, 'member', now())`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE.id}`;
  await sql`delete from invitation where email = ${INVITEE}`;
  // Cascades the member row.
  await sql`delete from "user" where id = ${PEER.id}`;
  await sql.end();
});

test("an owner can promote a member to admin from the table", async ({ page }) => {
  await page.goto(sitePath(SITE.slug, "settings/members"));

  const roleSelect = page.getByLabel(`Role of ${PEER.email}`);
  await expect(roleSelect).toBeVisible();
  await expect(roleSelect).toHaveValue("member");
  // The owner's picker offers all three roles.
  await expect(roleSelect.locator("option")).toHaveText(["Member", "Admin", "Owner"], {
    ignoreCase: true,
  });

  await roleSelect.selectOption("admin");
  await expect(roleSelect).toHaveValue("admin");

  await expect(async () => {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    const [row] = await sql`select role from member where user_id = ${PEER.id}`;
    await sql.end();
    expect(row.role).toBe("admin");
  }).toPass();
});

test("inviting with the owner role records it on the invitation", async ({ page }) => {
  await page.goto(sitePath(SITE.slug, "settings/members"));

  await page.getByPlaceholder("name@pixwel.com").fill(INVITEE);
  await page.getByLabel("Invite role").selectOption("owner");
  await page.getByRole("button", { name: "Send Invite" }).click();

  // The per-email outcome line confirms the send, and the pending list shows the role.
  await expect(page.getByText("Invited", { exact: true })).toBeVisible();
  await expect(
    page.locator("div", { hasText: INVITEE }).getByText("· owner"),
  ).toBeVisible();

  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [inv] =
    await sql`select role, status from invitation where email = ${INVITEE} order by expires_at desc limit 1`;
  await sql.end();
  expect(inv.status).toBe("pending");
  expect(inv.role).toBe("owner");
});
