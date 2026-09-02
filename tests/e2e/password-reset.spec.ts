import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { TEST_DB_URL } from "./global-setup";

// The password-reset journey end to end (SPEC §10.1): request → emailed link → new password →
// sign in with it. The "email" step reads the token straight out of Postgres, because the e2e
// server runs with no RESEND_API_KEY (deliberately — CI has no vendor account) and therefore
// only logs the message. That's not a workaround: it exercises exactly the token Better Auth
// minted and put in the link, so the assertion is about the real flow, not a stub.
//
// Everything goes through the browser rather than Playwright's API request context: that
// context resolves hosts through Node, which does NOT resolve `app.localhost` (Chromium does).
// Same family as the "tests fetch 127.0.0.1, not localhost" gotcha in CLAUDE.md.
//
// Signed-out, and on its OWN account rather than the shared TEST_USER:
// `revokeSessionsOnPasswordReset` kills every session for whoever is reset, which would
// invalidate the storageState the rest of the suite depends on.
test.use({ storageState: { cookies: [], origins: [] } });

const RESET_USER = {
  name: "Reset Journey",
  email: "reset-journey@papervine.test",
  password: "e2e-original-password-123",
};
const NEW_PASSWORD = "e2e-reset-password-456";

// Better Auth stores the reset token as `reset-password:<token>` in `verification`, with the
// user id as the value — the same token the emailed link carries.
async function latestResetToken(email: string): Promise<string> {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  try {
    const rows = await sql<{ identifier: string }[]>`
      select v.identifier
      from verification v
      join "user" u on u.id = v.value
      where v.identifier like 'reset-password:%' and u.email = ${email}
      order by v.created_at desc
      limit 1
    `;
    if (!rows.length) throw new Error(`no reset token was minted for ${email}`);
    return rows[0].identifier.replace("reset-password:", "");
  } finally {
    await sql.end();
  }
}

// Remove the journey's account if a previous run (or a previous attempt of this one) left it
// behind. `user` is the root of Better Auth's graph, so the cascade takes the rest.
async function deleteAccount(email: string): Promise<void> {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  try {
    await sql`delete from "user" where email = ${email}`;
  } finally {
    await sql.end();
  }
}

const resetLink = (token: string) =>
  `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("/reset-password")}`;

test("a forgotten password can be reset from the emailed link, and the old one stops working", async ({
  page,
}) => {
  // Four password hashes (signup, the reset itself, then a rejected and an accepted sign-in)
  // and six navigations in one test. Compilation is no longer part of it — the suite runs a
  // production build — but scrypt on the CI runner is not free, and `test.slow()`'s 90s was
  // still spent by the last sign-in. An explicit budget, because this test is a journey.
  test.setTimeout(180_000);
  // Own the precondition rather than inheriting it: signup rejects an address that already
  // exists, so without this a RETRY could never pass — it would sit on /signup until the
  // budget ran out and report a timeout on the wrong line. Deleting the user cascades to its
  // account, sessions and verification rows.
  await deleteAccount(RESET_USER.email);
  // Its own account, created through the real signup form.
  await page.goto("/signup");
  await page.getByLabel("Name").fill(RESET_USER.name);
  await page.getByLabel("Email").fill(RESET_USER.email);
  await page.getByLabel("Password").fill(RESET_USER.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  // NOT `expect(page).not.toHaveURL(/signup/)`: that carries the 5s per-assertion default,
  // which `test.slow()` does not raise (CLAUDE.md, the members-roles case), and it fired
  // while the cold signup POST was still compiling its route — twice in a row on CI, once as
  // a 35s test timeout and once as an assertion failure at 90s, which read as two different
  // bugs. The budget an assertion needs is the server round trip, not the render.
  await page.waitForURL((url) => !/\/signup/.test(url.pathname), { timeout: 90_000 });
  await page.context().clearCookies();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(RESET_USER.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  // Neutral confirmation — it must not reveal whether an account exists for that address.
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const token = await latestResetToken(RESET_USER.email);

  // Follow the emailed link exactly as a mail client would: Better Auth validates the token,
  // then redirects to our form carrying `?token=`.
  await page.goto(resetLink(token));
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

  // The old password is dead: the attempt completes (button returns from its pending label)
  // and we're still sitting on /login.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(RESET_USER.email);
  await page.getByLabel("Password").fill(RESET_USER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Same shape: /login is cold on this shard, so the sign-in round trip gets a real budget.
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(/\/login/);

  // The new one works.
  await page.getByLabel("Password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);

  // Single-use: a replayed link can't reset it again.
  await page.context().clearCookies();
  await page.goto(resetLink(token));
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
});

test("a reset link with no token shows the expired state rather than an empty form", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
});

test("the form catches mismatched passwords before calling the server", async ({ page }) => {
  await page.goto("/reset-password?token=any-token-shape");
  await page.getByLabel("New password", { exact: true }).fill("first-password-123");
  await page.getByLabel("Confirm new password").fill("second-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Those passwords don't match")).toBeVisible();
});
