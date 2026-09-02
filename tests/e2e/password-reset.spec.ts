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

const resetLink = (token: string) =>
  `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent("/reset-password")}`;

test("a forgotten password can be reset from the emailed link, and the old one stops working", async ({
  page,
}) => {
  // First test in its shard, so it cold-compiles /forgot-password, /reset-password and /login
  // itself. Unsharded this ran ~19 files deep, after those routes were warm — which is why it
  // was green for months and went red the moment the suite was split. Budget, not code.
  test.slow();
  // Its own account, created through the real signup form.
  await page.goto("/signup");
  await page.getByLabel("Name").fill(RESET_USER.name);
  await page.getByLabel("Email").fill(RESET_USER.email);
  await page.getByLabel("Password").fill(RESET_USER.password);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page).not.toHaveURL(/\/signup/);
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
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
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
