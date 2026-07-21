import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { TEST_USER, APEX_ORIGIN } from "./constants";
import { TEST_DB_URL } from "./global-setup";

// End-to-end coverage for the GitHub push webhook (SPEC §3 auto-sync) through the REAL
// route + real Postgres: signature gate, repo/branch mapping, idempotency, and that a
// matching push records a deployment. We sign payloads with the same secret the server
// is given in playwright.config (GITHUB_APP_WEBHOOK_SECRET). The webhook lives on the
// apex host (where middleware passes /api/ through with no auth gate), so we POST there.
const SECRET = "e2e-webhook-secret";
const SITE_ID = randomUUID();
const REPO_OWNER = "acme";
const REPO_NAME = "webhook-test";
const SYNCED_SHA = "already-synced-sha";
const WEBHOOK_URL = `${APEX_ORIGIN}/api/github/webhook`;

// Build a GitHub push payload + its X-Hub-Signature-256 over the raw JSON bytes.
const INSTALLATION_ID = 987654; // seeded github_installation for the code_change test
const SOURCE_REPO = "acme/source-api"; // a code_change trigger repo no site syncs from

function pushDelivery(
  overrides: {
    ref?: string;
    sha?: string;
    message?: string;
    owner?: string;
    repo?: string;
    installationId?: number;
  } = {},
) {
  const sha = overrides.sha ?? randomUUID().replace(/-/g, "");
  const payload: Record<string, unknown> = {
    ref: overrides.ref ?? "refs/heads/main",
    after: sha,
    head_commit: { id: sha, message: overrides.message ?? "docs: update" },
    repository: {
      name: overrides.repo ?? REPO_NAME,
      owner: { login: overrides.owner ?? REPO_OWNER, name: overrides.owner ?? REPO_OWNER },
    },
    commits: [{ added: ["docs.json"], modified: [], removed: [] }],
  };
  if (overrides.installationId != null) payload.installation = { id: overrides.installationId };
  const raw = JSON.stringify(payload);
  const signature = "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");
  return { raw, signature, sha };
}

test.beforeAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  const [org] =
    await sql`select id from organization where name = ${TEST_USER.org} limit 1`;
  if (!org) throw new Error(`test org "${TEST_USER.org}" not found`);
  await sql`delete from site where id = ${SITE_ID}`;
  await sql`delete from github_installation where installation_id = ${INSTALLATION_ID}`;
  await sql`insert into github_installation (id, organization_id, installation_id, account_login)
            values (${randomUUID()}, ${org.id}, ${INSTALLATION_ID}, ${REPO_OWNER})`;
  await sql`insert into site (id, organization_id, name, slug, repo_owner, repo_name, branch, docs_path, status, last_synced_commit_sha, github_installation_id)
            values (${SITE_ID}, ${org.id}, 'Webhook Site', 'e2e-webhook', ${REPO_OWNER}, ${REPO_NAME}, 'main', '', 'live', ${SYNCED_SHA}, ${INSTALLATION_ID})`;
  // An enabled code_change automation whose trigger repo is SOURCE_REPO (which no site syncs from).
  await sql`insert into automation (id, site_id, catalog_key, enabled, trigger_type, trigger_repos, apply_mode)
            values (${randomUUID()}, ${SITE_ID}, 'update-from-code-changes', true, 'code_change', ${sql.json([SOURCE_REPO])}, 'review')`;
  await sql.end();
});

test.afterAll(async () => {
  const sql = postgres(TEST_DB_URL, { max: 1 });
  await sql`delete from site where id = ${SITE_ID}`;
  await sql`delete from github_installation where installation_id = ${INSTALLATION_ID}`;
  await sql.end();
});

async function post(raw: string, headers: Record<string, string>) {
  const ctx = await playwrightRequest.newContext();
  const res = await ctx.post(WEBHOOK_URL, {
    headers: { "content-type": "application/json", "x-github-event": "push", ...headers },
    data: raw,
  });
  await ctx.dispose();
  return res;
}

test("rejects an unsigned delivery with 401", async () => {
  const { raw } = pushDelivery();
  const res = await post(raw, {}); // no signature header
  expect(res.status()).toBe(401);
});

test("rejects a tampered body with 401", async () => {
  const { signature } = pushDelivery({ message: "original" });
  const tampered = pushDelivery({ message: "tampered" }).raw;
  const res = await post(tampered, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(401);
});

test("no-ops (204) a valid push for a repo no site points at", async () => {
  const { raw, signature } = pushDelivery({ owner: "nobody", repo: "nothing" });
  const res = await post(raw, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(204);
});

test("no-ops (204) a push to a branch no site tracks", async () => {
  const { raw, signature } = pushDelivery({ ref: "refs/heads/some-feature" });
  const res = await post(raw, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(204);
});

test("no-ops (204) when the head sha is already synced (idempotent redelivery)", async () => {
  const { raw, signature } = pushDelivery({ sha: SYNCED_SHA });
  const res = await post(raw, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(204);
});

test("accepts (202) a push to a code_change trigger repo no site syncs from", async () => {
  // SOURCE_REPO matches an enabled code_change automation via the seeded installation,
  // even though no site syncs from it. The webhook must resolve installation.id → org and
  // take the code_change fan-out branch (202), not 204. The executor is blanked in e2e
  // (TRIGGER_SECRET_KEY=""), so the fan-out no-ops without creating a run — we assert the
  // clean 202 + no crash, which proves the route wiring end-to-end.
  const [owner, repo] = SOURCE_REPO.split("/");
  const { raw, signature } = pushDelivery({ owner, repo, installationId: INSTALLATION_ID });
  const res = await post(raw, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(202);

  // Executor-blank contract: no automation_run row is created.
  const sql = postgres(TEST_DB_URL, { max: 1 });
  try {
    const rows = await sql`select id from automation_run where site_id = ${SITE_ID}`;
    expect(rows).toHaveLength(0);
  } finally {
    await sql.end();
  }
});

test("accepts (202) a matching push and records a deployment", async () => {
  const message = `e2e push ${randomUUID()}`;
  const { raw, signature, sha } = pushDelivery({ message });
  const res = await post(raw, { "x-hub-signature-256": signature });
  expect(res.status()).toBe(202);

  // The sync runs in after() (fire-and-forget). It targets a repo that doesn't exist, so
  // syncSite throws and runSync records a *failed* deployment — but a deployment row with
  // this push's commit message + sha and a null actor (a system/webhook sync) still
  // appears, which is exactly what we're asserting (the webhook → runSync wiring).
  const sql = postgres(TEST_DB_URL, { max: 1 });
  try {
    await expect
      .poll(
        async () => {
          const rows = await sql`select commit_sha, actor_user_id from deployment
                                 where site_id = ${SITE_ID} and commit_message = ${message} limit 1`;
          return rows[0]?.commit_sha ?? null;
        },
        { timeout: 15_000, intervals: [250, 500, 1000] },
      )
      .toBe(sha);
    const [row] =
      await sql`select actor_user_id from deployment where site_id = ${SITE_ID} and commit_message = ${message} limit 1`;
    expect(row.actor_user_id).toBeNull();
  } finally {
    await sql.end();
  }
});
