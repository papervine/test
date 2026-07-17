// Publish src/lib/billing/catalog.json into the billing catalog tables. Run:
//   npm run billing:sync
//
// This is the "repricing is a config edit, not a deploy" mechanism (app-schema.ts
// BILLING header). Idempotent and append-only:
//   - plans:        upsert display fields by key
//   - plan versions: INSERT a new (plan, version+1) row only when the config hash of
//                    {entitlements, credits, overage} changed; never UPDATE a published
//                    version (subscriptions pin them)
//   - prices:       match by (plan, interval, amount, currency); missing -> INSERT,
//                    no-longer-in-catalog -> active=false (archive, never delete —
//                    Stripe subs may still bill on them)
//   - credit packs: same archive discipline, matched by key
//   - credit rates: INSERT when catalog version > max published version
//
// Stripe objects are NOT touched here — publishing to Stripe is the admin "publish"
// action (Phase 3), which reads these same rows. Safe to run against any environment.
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local)");
  process.exit(1);
}

const catalogPath = fileURLToPath(
  new URL("../src/lib/billing/catalog.json", import.meta.url),
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

// Deterministic stringify (sorted keys) so the hash doesn't churn on key order.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// The version identity: exactly the fields whose change should mint a new plan version.
function planConfigHash(plan) {
  return createHash("sha256")
    .update(
      stableStringify({
        entitlements: plan.entitlements,
        includedMonthlyCredits: plan.includedMonthlyCredits,
        overageCentsPerThousandCredits: plan.overageCentsPerThousandCredits,
      }),
    )
    .digest("hex");
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  const summary = [];

  // --- plans (upsert display fields; the key is the identity) ---
  for (const plan of catalog.plans) {
    await sql`
      INSERT INTO billing_plan (key, name, blurb, listed, sort)
      VALUES (${plan.key}, ${plan.name}, ${plan.blurb}, ${plan.listed}, ${plan.sort})
      ON CONFLICT (key) DO UPDATE SET
        name = EXCLUDED.name, blurb = EXCLUDED.blurb,
        listed = EXCLUDED.listed, sort = EXCLUDED.sort, updated_at = now()
    `;
  }
  summary.push(`plans: ${catalog.plans.length} upserted`);

  // --- plan versions (append on hash change) ---
  let minted = 0;
  for (const plan of catalog.plans) {
    const hash = planConfigHash(plan);
    const [latest] = await sql`
      SELECT id, version, config_hash FROM billing_plan_version
      WHERE plan_key = ${plan.key} ORDER BY version DESC LIMIT 1
    `;
    if (latest?.config_hash === hash) continue;
    const nextVersion = (latest?.version ?? 0) + 1;
    await sql`
      INSERT INTO billing_plan_version
        (id, plan_key, version, entitlements, included_monthly_credits,
         overage_cents_per_thousand_credits, config_hash, notes)
      VALUES
        (${randomUUID()}, ${plan.key}, ${nextVersion}, ${sql.json(plan.entitlements)},
         ${plan.includedMonthlyCredits}, ${plan.overageCentsPerThousandCredits},
         ${hash}, ${"billing:sync from catalog.json"})
    `;
    minted += 1;
    console.log(`  ${plan.key}: minted version ${nextVersion}`);
  }
  summary.push(`plan versions: ${minted} minted`);

  // --- prices (append missing, archive vanished) ---
  const dbPrices = await sql`SELECT * FROM billing_price`;
  const priceIdent = (p) =>
    `${p.planKey ?? p.plan_key}|${p.interval}|${p.unitAmountCents ?? p.unit_amount_cents}|${p.currency}`;
  const wanted = new Set(catalog.prices.map(priceIdent));
  let priceAdds = 0;
  for (const price of catalog.prices) {
    if (dbPrices.some((p) => priceIdent(p) === priceIdent(price))) continue;
    await sql`
      INSERT INTO billing_price (id, plan_key, interval, unit_amount_cents, currency)
      VALUES (${randomUUID()}, ${price.planKey}, ${price.interval},
              ${price.unitAmountCents}, ${price.currency})
    `;
    priceAdds += 1;
  }
  let priceArchives = 0;
  for (const p of dbPrices) {
    if (p.active && !wanted.has(priceIdent(p))) {
      await sql`UPDATE billing_price SET active = false WHERE id = ${p.id}`;
      priceArchives += 1;
    }
  }
  summary.push(`prices: ${priceAdds} added, ${priceArchives} archived`);

  // --- credit packs (same discipline, keyed) ---
  let packAdds = 0;
  let packArchives = 0;
  const dbPacks = await sql`SELECT * FROM credit_pack`;
  for (const pack of catalog.creditPacks) {
    const existing = dbPacks.find((p) => p.key === pack.key);
    if (!existing) {
      await sql`
        INSERT INTO credit_pack (id, key, name, credits, price_cents)
        VALUES (${randomUUID()}, ${pack.key}, ${pack.name}, ${pack.credits}, ${pack.priceCents})
      `;
      packAdds += 1;
    } else if (
      existing.credits !== pack.credits ||
      existing.price_cents !== pack.priceCents
    ) {
      // A changed pack is a NEW pack (old one may be mid-checkout / on invoices):
      // archive the old row; the catalog author must give the new shape a new key.
      console.error(
        `  credit pack '${pack.key}' changed credits/price — give it a new key instead ` +
          `(old rows are immutable). Skipped.`,
      );
    } else if (!existing.active) {
      await sql`UPDATE credit_pack SET active = true WHERE id = ${existing.id}`;
    }
  }
  for (const p of dbPacks) {
    if (p.active && !catalog.creditPacks.some((c) => c.key === p.key)) {
      await sql`UPDATE credit_pack SET active = false WHERE id = ${p.id}`;
      packArchives += 1;
    }
  }
  summary.push(`credit packs: ${packAdds} added, ${packArchives} archived`);

  // --- credit rate table (append when catalog version advances) ---
  const [maxRate] = await sql`SELECT max(version) AS v FROM credit_rate_version`;
  const current = maxRate?.v ?? 0;
  if (catalog.creditRates.version > current) {
    const { $comment: _drop, ...rates } = catalog.creditRates;
    await sql`
      INSERT INTO credit_rate_version (id, version, rates, notes)
      VALUES (${randomUUID()}, ${catalog.creditRates.version}, ${sql.json(rates)},
              ${"billing:sync from catalog.json"})
    `;
    summary.push(`credit rates: published v${catalog.creditRates.version}`);
  } else if (catalog.creditRates.version < current) {
    console.error(
      `  catalog creditRates.version (${catalog.creditRates.version}) is behind the DB ` +
        `(${current}) — bump it in catalog.json to publish new rates.`,
    );
    summary.push("credit rates: unchanged (catalog behind DB)");
  } else {
    summary.push("credit rates: unchanged");
  }

  console.log(`billing catalog synced → ${summary.join("; ")}`);
} finally {
  await sql.end();
}
