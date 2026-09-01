import { test, expect, type APIRequestContext } from "@playwright/test";
import { APEX_ORIGIN, TEST_USER } from "./constants";

// Device authorization grant, end to end (SPEC §11.4) — the journey behind `papervine signup` /
// `papervine login`. The CLI's own decision layer is unit-tested (tests/unit/cli-auth.test.ts);
// what needs a browser and a real database is the half in between: a code minted over HTTP, a
// human approving it in a page that has to CLAIM the row before it can approve it, and a token
// that then has to work as a bearer credential on a completely different request.
//
// Everything here goes through the public HTTP surface rather than Better Auth's server API, on
// purpose: that is what an external client sees, and a mistake in the routing or the middleware
// (this page keeps a bare URL on a host that rewrites everything else) is invisible from inside.

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

// The HTTP calls address the APEX (`127.0.0.1`), not `baseURL`'s `app.localhost`, and that is a
// harness fact rather than a design one: Playwright's APIRequestContext resolves through Node's
// DNS, which does not map `*.localhost` — only the browser does (`ENOTFOUND app.localhost`). The
// `/api/auth/*` endpoints answer on either host (one route tree), and the human-facing
// `verification_uri` comes back pinned to the app host by BETTER_AUTH_URL regardless of which
// host asked — which this spec then follows in a real browser. Reaching the app host with a real
// Host header is covered by tests/smoke.mjs.
const api = (path: string) => `${APEX_ORIGIN}${path}`;

/** Start a flow the way a CLI does. Unauthenticated — that's the point of a public client. */
async function requestCode(request: APIRequestContext, clientId = "papervine-cli") {
  const res = await request.post(api("/api/auth/device/code"), {
    data: { client_id: clientId },
  });
  expect(res.ok(), `device/code failed: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>;
}

/**
 * Exchange (or try to). Returns the status + body, since the grant signals through the body.
 *
 * `clientId` is a real parameter rather than a constant because the code is BOUND to the client
 * that requested it — exchanging with a different one is `invalid_grant`, which is the property
 * the mismatch test below pins.
 */
async function exchange(
  request: APIRequestContext,
  deviceCode: string,
  clientId = "papervine-cli",
) {
  const res = await request.post(api("/api/auth/device/token"), {
    data: { grant_type: GRANT, device_code: deviceCode, client_id: clientId },
  });
  return { status: res.status(), body: (await res.json()) as Record<string, string> };
}

test("the verification page names the client and the code, and pends until approved", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });

  const flow = await requestCode(request, "some-other-agent");

  // Before approval, the grant must say "pending" — not "denied", and certainly not a token.
  const early = await exchange(request, flow.device_code, "some-other-agent");
  expect(early.status).toBe(400);
  expect(early.body.error).toBe("authorization_pending");

  // And the code is bound to the client that asked for it: another client holding the device
  // code cannot redeem it, even after approval.
  const wrongClient = await exchange(request, flow.device_code, "papervine-cli");
  expect(wrongClient.status).toBe(400);
  expect(wrongClient.body.error).toBe("invalid_grant");

  // The server's own verification_uri_complete is what `papervine login` opens.
  await page.goto(flow.verification_uri_complete);
  await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
  // Named client + visible code: the two things that let a human notice a flow they didn't
  // start. A device grant's known weakness is being talked into approving someone else's code.
  await expect(page.getByText("some-other-agent")).toBeVisible();
  await expect(page.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /didn’t start this/ })).toBeVisible();

  const reactErrors = errors.filter(
    (e) =>
      e.startsWith("pageerror:") ||
      /flushSync|Maximum update depth|Cannot update a component|not wrapped in act|hydrat/i.test(e),
  );
  expect(reactErrors, `unexpected React errors:\n${reactErrors.join("\n")}`).toEqual([]);
});

test("approving hands the client a token that works as a bearer credential", async ({
  page,
  request,
}) => {
  const flow = await requestCode(request);

  await page.goto(flow.verification_uri_complete);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Device connected" })).toBeVisible();

  const granted = await exchange(request, flow.device_code);
  expect(granted.status, JSON.stringify(granted.body)).toBe(200);
  expect(granted.body.token_type).toBe("Bearer");
  expect(granted.body.access_token).toBeTruthy();

  // The payoff, and the part that would silently not work without the bearer() plugin: the
  // token has to authenticate a request that carries no cookie at all. `request` here is the
  // authed context, so strip its state by asserting through a header-only fetch.
  const me = await request.get(api("/api/me"), {
    headers: { authorization: `Bearer ${granted.body.access_token}` },
  });
  expect(me.status()).toBe(200);
  const identity = await me.json();
  expect(identity.user.email).toBe(TEST_USER.email);
  expect(identity.organizations.map((o: { slug: string }) => o.slug)).toContain("test-org");

  // One-shot: the row is deleted on exchange, so a replayed device_code gets nothing. This is
  // what stops a stolen device code from being a reusable credential.
  const replay = await exchange(request, flow.device_code);
  expect(replay.status).toBe(400);
  expect(replay.body.error).toBe("invalid_grant");
});

test("the ADVERTISED token endpoint redeems a device code, form-encoded", async ({
  page,
  request,
}) => {
  // The metadata document names one `token_endpoint` and claims the device grant, so RFC 8628
  // §3.4 says a device code is redeemable *there*. Two Better Auth plugins mount two token
  // endpoints, so a shim forwards this one — without it a spec-following client reads our
  // document, does exactly what it says, and gets a schema error. Nothing else covers that path:
  // our own CLI skips discovery and posts straight to /device/token.
  const flow = await requestCode(request);
  await page.goto(flow.verification_uri_complete);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Device connected" })).toBeVisible();

  // Form-encoded, as OAuth specifies for a token request — the encoding the device endpoint
  // would otherwise reject.
  const res = await request.post(api("/api/auth/mcp/token"), {
    form: {
      grant_type: GRANT,
      device_code: flow.device_code,
      client_id: "papervine-cli",
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.token_type).toBe("Bearer");
  expect(body.access_token).toBeTruthy();
});

test("refusing in the browser reports access_denied to the waiting client", async ({
  page,
  request,
}) => {
  const flow = await requestCode(request);

  await page.goto(flow.verification_uri_complete);
  await page.getByRole("button", { name: /didn’t start this/ }).click();
  await expect(page.getByRole("heading", { name: "Request refused" })).toBeVisible();

  const denied = await exchange(request, flow.device_code);
  expect(denied.status).toBe(400);
  expect(denied.body.error).toBe("access_denied");
});

test("an unknown code is refused without revealing whether it ever existed", async ({ page }) => {
  await page.goto("/device?user_code=ZZZZ9999");
  await expect(page.getByRole("heading", { name: "Code not recognized" })).toBeVisible();
});

test("a lower-case code still resolves", async ({ page, request }) => {
  // Better Auth's own lookup strips `-` but does NOT upper-case, so without normalizeUserCode a
  // hand-typed code fails against a row that is sitting right there.
  const flow = await requestCode(request);
  await page.goto(`/device?user_code=${flow.user_code.toLowerCase()}`);
  await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
});

test("/device with no code offers the RFC 8628 code-entry form", async ({ page, request }) => {
  const flow = await requestCode(request);
  await page.goto("/device");
  await expect(page.getByRole("heading", { name: "Connect a device" })).toBeVisible();
  await page.getByLabel("Code").fill(flow.user_code);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the OAuth metadata document is public on the app host and names both grants", async ({
    page,
  }) => {
    // The whole reason a CLI verb isn't the only door: a client that has never heard of us reads
    // this and authorizes itself. Fetched through the BROWSER because the app host is where the
    // trap is — every other path there is rewritten onto /app and would hit the auth gate, so a
    // client asking "how do I authorize?" would be answered with a 307 to a login page.
    const res = await page.goto("/.well-known/oauth-authorization-server");
    expect(res?.status()).toBe(200);
    const meta = await res!.json();

    // One authorization server, one description of it: the authoring MCP's code flow (SPEC §9.2)
    // and the device grant (§11.4) are both here, so a client learns everything in one fetch and
    // can pick the flow its own shape allows.
    expect(meta.grant_types_supported).toContain("authorization_code");
    expect(meta.grant_types_supported).toContain(GRANT);
    expect(meta.authorization_endpoint).toContain("/api/auth/mcp/authorize");
    expect(meta.registration_endpoint).toContain("/api/auth/mcp/register");
    expect(meta.device_authorization_endpoint).toContain("/api/auth/device/code");
  });

  test("the page survives the edge gate and resumes after signing in", async ({
    page,
    request,
  }) => {
    const flow = await requestCode(request);

    // The app host bounces everything unauthenticated to /login. This page must NOT be bounced,
    // or the user code the CLI printed is swallowed and the flow is unrecoverable.
    await page.goto(flow.verification_uri_complete);
    await expect(page).toHaveURL(/\/device\?/);
    await expect(page.getByRole("heading", { name: "Sign in to continue" })).toBeVisible();

    // Both offers carry the code back to here in ?redirect= — that is what makes
    // `papervine signup` one uninterrupted flow rather than "now go find that URL again".
    const resume = encodeURIComponent(`/device?user_code=${flow.user_code}`);
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      `/signup?redirect=${resume}`,
    );
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/login?redirect=${resume}`,
    );

    // Sign in through the real form and land back on the approval page, not the dashboard.
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Connect this device?" })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("an already-signed-in visitor arriving at /signup?redirect= is not dumped on the dashboard", async ({
    browser,
    request,
  }) => {
    // The middleware sends a signed-in visitor away from the auth pages — correctly, except
    // when they arrived mid-flow. `papervine signup` sends everyone to /signup, including
    // people who turn out to already have an account, and dropping the redirect there makes
    // the device approval silently vanish.
    const flow = await requestCode(request);
    const ctx = await browser.newContext({ storageState: "tests/e2e/.auth/user.json" });
    const authed = await ctx.newPage();
    await authed.goto(`/signup?redirect=${encodeURIComponent(`/device?user_code=${flow.user_code}`)}`);
    await expect(authed).toHaveURL(/\/device\?user_code=/);
    await expect(authed.getByRole("heading", { name: "Connect this device?" })).toBeVisible();
    await ctx.close();
  });
});
