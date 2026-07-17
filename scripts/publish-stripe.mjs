// Publish the DB billing catalog to Stripe: Products for paid plans + the credit-pack
// family, Prices for rows that don't have a stripe id yet. Run AFTER billing:sync:
//   npm run billing:sync && npm run billing:publish
//
// CLI twin of publishCatalogToStripe() in src/lib/billing/stripe.ts (the admin UI's
// publish button) — keep the two in step if the shape changes. Idempotent: only
// missing Stripe objects are created; existing ids are never touched (Stripe Prices
// are immutable — a price change is a new billing_price row, which gets a new Stripe
// Price here). Uses whatever mode STRIPE_SECRET_KEY selects (sk_test_/sk_live_) — each
// environment's DB carries its own mode's ids.
import postgres from "postgres";
import Stripe from "stripe";

const { DATABASE_URL, STRIPE_SECRET_KEY } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set (run with --env-file=.env.local)");
  process.exit(1);
}
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is not set — add it to .env.local first.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const mode = STRIPE_SECRET_KEY.startsWith("sk_live_") ? "LIVE" : "test";

try {
  let products = 0;
  let prices = 0;

  const plans = await sql`SELECT * FROM billing_plan`;
  const priceRows = await sql`SELECT * FROM billing_price`;

  for (const plan of plans) {
    const planPrices = priceRows.filter((p) => p.plan_key === plan.key);
    if (planPrices.length === 0) continue; // free/trial/enterprise: nothing to sell

    let productId = plan.stripe_product_id;
    if (!productId) {
      const product = await stripe.products.create({
        name: `Papervine ${plan.name}`,
        description: plan.blurb || undefined,
        metadata: { papervinePlanKey: plan.key },
      });
      productId = product.id;
      await sql`UPDATE billing_plan SET stripe_product_id = ${productId}, updated_at = now() WHERE key = ${plan.key}`;
      products += 1;
      console.log(`  product: ${plan.key} → ${productId}`);
    }
    for (const row of planPrices.filter((p) => p.active && !p.stripe_price_id)) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: row.unit_amount_cents,
        currency: row.currency,
        recurring: { interval: row.interval },
        metadata: { papervinePriceId: row.id },
      });
      await sql`UPDATE billing_price SET stripe_price_id = ${price.id} WHERE id = ${row.id}`;
      prices += 1;
      console.log(`  price: ${plan.key}/${row.interval} $${(row.unit_amount_cents / 100).toFixed(2)} → ${price.id}`);
    }
  }

  const packs = await sql`SELECT * FROM credit_pack WHERE active AND stripe_price_id IS NULL`;
  if (packs.length > 0) {
    const found = await stripe.products.search({
      query: `metadata['papervineCreditPack']:'family'`,
      limit: 1,
    });
    const packProduct =
      found.data[0] ??
      (await stripe.products.create({
        name: "Papervine AI credits",
        metadata: { papervineCreditPack: "family" },
      }));
    for (const pack of packs) {
      const price = await stripe.prices.create({
        product: packProduct.id,
        unit_amount: pack.price_cents,
        currency: "usd",
        metadata: { papervinePackKey: pack.key, credits: String(pack.credits) },
      });
      await sql`UPDATE credit_pack SET stripe_price_id = ${price.id} WHERE id = ${pack.id}`;
      prices += 1;
      console.log(`  pack price: ${pack.key} $${(pack.price_cents / 100).toFixed(2)} → ${price.id}`);
    }
  }

  console.log(`stripe (${mode}) published → ${products} products, ${prices} prices created`);
} finally {
  await sql.end();
}
