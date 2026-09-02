#!/usr/bin/env node
// Make every organization in the database exist as an Autumn customer (SPEC §10 Billing).
//
// Autumn is the source of truth for plans and balances, and a customer is created lazily —
// by the org-creation auth hook (`startTrial`) or the first billing action. Orgs that predate
// the cutover, and orgs seeded straight into the database, therefore have NO customer: they
// resolve to the Free floor with nothing metered. This is the backfill. It sends exactly the
// fields the app sends (`ensureCustomer`: org id as the customer id, org name, owner email)
// and is idempotent — `getOrCreate` is a no-op for a customer that already exists.
//
//   node --env-file=.env.local scripts/sync-autumn-customers.mjs            # dry run: report
//   node --env-file=.env.local scripts/sync-autumn-customers.mjs --apply    # create the missing
//   node --env-file=.env.local scripts/sync-autumn-customers.mjs --apply --trial
//
// A customer that already exists but carries no name/email (created by an older hook that
// sent only the id) gets them filled in on `--apply` — that is the only write ever made to
// an existing customer; its plans and balances are never touched.
//
// `--trial` mirrors what a NEW org gets: after creating the customer it attaches the 30-day
// `pro_trial` plan — but only to a customer this run created, never to one that already
// existed (which may hold a real subscription). Which Autumn environment is written to is
// decided by AUTUMN_SECRET_KEY alone (a test key → sandbox, a live key → production), and
// which orgs are read by DATABASE_URL — both are printed before anything is written, so a
// mismatched pair (prod DB, sandbox key) is visible rather than silent. It never deletes.
//
// The same file serves every pairing: dev DB → sandbox today; prod DB → live when the key
// flips. `db:seed` also imports `syncAutumnCustomers` so a reseeded dev org lands in sandbox
// without a manual step.

import postgres from "postgres";

export const TRIAL_PLAN_ID = "pro_trial";

/** Which Autumn environment a secret key addresses, from its prefix. Unknown → "unknown". */
export function autumnEnvFor(secretKey) {
  if (!secretKey) return "none";
  if (secretKey.startsWith("am_sk_test_")) return "sandbox";
  if (secretKey.startsWith("am_sk_live_")) return "live";
  return "unknown";
}

/** Host of a Postgres URL, for the pre-flight print. Never the credentials. */
export function dbHostOf(url) {
  try {
    return new URL(url).host || "(no host)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/** Every org with its owner's email/name (first owner by membership date; null if none). */
export async function listOrgs(sql) {
  return sql`
    select o.id, o.slug, o.name, o.created_at,
           u.email as owner_email, u.name as owner_name
      from organization o
      left join lateral (
        select u.email, u.name
          from member m join "user" u on u.id = m.user_id
         where m.organization_id = o.id and m.role = 'owner'
         order by m.created_at asc
         limit 1
      ) u on true
     order by o.created_at asc`;
}

/**
 * Core, shared with db:seed. Returns one row per org: { id, slug, action } where action is
 * "exists" | "updated" | "created" | "created+trial" | "would-create" | "error".
 */
export async function syncAutumnCustomers({ sql, secretKey, apply, trial, log = console.log }) {
  const orgs = await listOrgs(sql);
  const results = [];
  if (!secretKey) {
    log("• AUTUMN_SECRET_KEY is unset — nothing to sync to.");
    return results;
  }
  const { Autumn } = await import("autumn-js");
  const client = new Autumn({ secretKey });

  for (const org of orgs) {
    const label = `${org.slug} (${org.id.slice(0, 8)}…)`;
    let existing = null;
    try {
      existing = await client.customers.get({ customerId: org.id });
    } catch (err) {
      const status = err?.statusCode ?? err?.status;
      if (status !== 404) {
        log(`  ✗ ${label}: lookup failed (${err?.message ?? err})`);
        results.push({ id: org.id, slug: org.slug, action: "error" });
        continue;
      }
    }
    if (existing?.id) {
      // The SDK camelCases response keys (planId), unlike the REST API (plan_id) — see
      // src/lib/billing/autumn-keys.ts. This script talks to the SDK directly.
      const plans = (existing.subscriptions ?? []).map((s) => s.planId ?? s.plan_id).join(", ") || "none";
      const missing = [];
      if (!existing.name && org.name) missing.push("name");
      if (!existing.email && org.owner_email) missing.push("email");
      if (missing.length && apply) {
        try {
          await client.customers.update({
            customerId: org.id,
            ...(existing.name ? {} : org.name ? { name: org.name } : {}),
            ...(existing.email ? {} : org.owner_email ? { email: org.owner_email } : {}),
          });
          log(`  ~ ${label}: exists · plans: ${plans} · filled in ${missing.join(" + ")}`);
          results.push({ id: org.id, slug: org.slug, action: "updated" });
        } catch (err) {
          log(`  ✗ ${label}: update failed (${err?.message ?? err})`);
          results.push({ id: org.id, slug: org.slug, action: "error" });
        }
        continue;
      }
      const note = missing.length ? ` · would fill in ${missing.join(" + ")}` : "";
      log(`  = ${label}: exists · plans: ${plans}${note}`);
      results.push({ id: org.id, slug: org.slug, action: "exists" });
      continue;
    }
    if (!apply) {
      log(`  + ${label}: would create${trial ? " + attach " + TRIAL_PLAN_ID : ""}`);
      results.push({ id: org.id, slug: org.slug, action: "would-create" });
      continue;
    }
    try {
      await client.customers.getOrCreate({
        customerId: org.id,
        ...(org.name ? { name: org.name } : {}),
        ...(org.owner_email ? { email: org.owner_email } : {}),
      });
      let action = "created";
      if (trial) {
        await client.billing.attach({ customerId: org.id, planId: TRIAL_PLAN_ID });
        action = "created+trial";
      }
      log(`  + ${label}: ${action}`);
      results.push({ id: org.id, slug: org.slug, action });
    } catch (err) {
      log(`  ✗ ${label}: create failed (${err?.message ?? err})`);
      results.push({ id: org.id, slug: org.slug, action: "error" });
    }
  }
  return results;
}

const isMain = process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href;
if (isMain) {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const trial = args.has("--trial");
  const secretKey = process.env.AUTUMN_SECRET_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    console.error("DATABASE_URL is unset (run with --env-file=<env file>).");
    process.exit(1);
  }
  console.log(`Autumn env: ${autumnEnvFor(secretKey)} · database: ${dbHostOf(dbUrl)} · mode: ${apply ? "APPLY" : "dry run"}${trial ? " · trial: yes" : ""}`);
  const sql = postgres(dbUrl, { max: 1 });
  try {
    const results = await syncAutumnCustomers({ sql, secretKey, apply, trial });
    const count = (a) => results.filter((r) => r.action === a).length;
    console.log(
      `${results.length} org(s): ${count("exists")} existed, ${count("updated")} filled in, ${count("created") + count("created+trial")} created, ${count("would-create")} would be created, ${count("error")} failed.`,
    );
    if (count("error")) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
