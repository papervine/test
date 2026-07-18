import Link from "next/link";
import { desc, eq, max, sql } from "drizzle-orm";
import { ArrowLeft, CreditCard } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import {
  billingPlan,
  billingPlanVersion,
  billingPrice,
  billingSubscription,
  creditBalance,
  creditPack,
  creditRateVersion,
  stripeEvent,
} from "@/lib/db/app-schema";
import { PlatformShell } from "@/components/platform/PlatformShell";
import { AdjustCreditsForm, GrantPlanForm, PublishButton } from "./AdminBillingActions";

// Platform-admin billing console (SPEC §10 Billing, Phase 4; same §10.10 gate as
// /admin). The CATALOG here is read-only by design — the source of truth is
// src/lib/billing/catalog.json edited in a PR + `billing:sync` (append-only versioning
// happens there); this page shows what's live, publishes it to Stripe, and gives
// support the one manual lever: credit adjustments with an actor + reason.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AdminBillingPage() {
  await requirePlatformAdmin();

  const [plans, prices, packs, [rate], events, orgs] = await Promise.all([
    // Latest version per plan.
    db
      .select({
        key: billingPlan.key,
        name: billingPlan.name,
        listed: billingPlan.listed,
        sort: billingPlan.sort,
        stripeProductId: billingPlan.stripeProductId,
        version: max(billingPlanVersion.version),
        includedMonthlyCredits: sql<number>`(array_agg(${billingPlanVersion.includedMonthlyCredits} ORDER BY ${billingPlanVersion.version} DESC))[1]`,
      })
      .from(billingPlan)
      .leftJoin(billingPlanVersion, eq(billingPlanVersion.planKey, billingPlan.key))
      .groupBy(billingPlan.key)
      .orderBy(billingPlan.sort),
    db.select().from(billingPrice).orderBy(billingPrice.planKey, billingPrice.interval),
    db.select().from(creditPack).orderBy(creditPack.credits),
    db.select().from(creditRateVersion).orderBy(desc(creditRateVersion.version)).limit(1),
    db.select().from(stripeEvent).orderBy(desc(stripeEvent.receivedAt)).limit(12),
    // Orgs with billing state, for the adjustment form's picker.
    db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: billingSubscription.status,
        planVersionId: billingSubscription.planVersionId,
        trial: creditBalance.trialCredits,
        monthly: creditBalance.monthlyCredits,
        pack: creditBalance.packCredits,
      })
      .from(organization)
      .leftJoin(
        billingSubscription,
        eq(billingSubscription.organizationId, organization.id),
      )
      .leftJoin(creditBalance, eq(creditBalance.organizationId, organization.id))
      .orderBy(organization.name),
  ]);

  return (
    <PlatformShell variant="lite">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-4 w-4" /> Platform Admin
        </Link>
        <h1 className="mt-4 flex items-center gap-2 text-2xl font-semibold">
          <CreditCard className="h-6 w-6" /> Billing console
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Catalog is edited in <code>src/lib/billing/catalog.json</code> +{" "}
          <code>npm run billing:sync</code> (append-only plan versions). This console
          publishes it to Stripe and handles support credit adjustments.
        </p>

        {/* Catalog */}
        <h2 className="mt-10 text-sm font-semibold">Catalog (live)</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[rgba(var(--ink-rgb),0.08)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="px-4 py-2.5 font-normal">Plan</th>
                <th className="px-4 py-2.5 font-normal">Version</th>
                <th className="px-4 py-2.5 font-normal">Credits/mo</th>
                <th className="px-4 py-2.5 font-normal">Prices</th>
                <th className="px-4 py-2.5 font-normal">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const planPrices = prices.filter((pr) => pr.planKey === p.key);
                return (
                  <tr key={p.key} className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                    <td className="px-4 py-2.5 font-medium">
                      {p.name}
                      {!p.listed && (
                        <span className="ml-2 text-xs text-[var(--muted)]">unlisted</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">v{p.version ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {(p.includedMonthlyCredits ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      {planPrices.length === 0
                        ? "—"
                        : planPrices
                            .filter((pr) => pr.active)
                            .map(
                              (pr) =>
                                `$${(pr.unitAmountCents / 100).toFixed(0)}/${pr.interval === "month" ? "mo" : "yr"}`,
                            )
                            .join(" · ")}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                      {p.stripeProductId ??
                        (planPrices.length > 0 ? "not published" : "—")}
                    </td>
                  </tr>
                );
              })}
              {packs.map((pk) => (
                <tr key={pk.key} className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td className="px-4 py-2.5 font-medium">
                    {pk.name}
                    <span className="ml-2 text-xs text-[var(--muted)]">pack</span>
                  </td>
                  <td className="px-4 py-2.5">—</td>
                  <td className="px-4 py-2.5 tabular-nums">{pk.credits.toLocaleString()}</td>
                  <td className="px-4 py-2.5">${(pk.priceCents / 100).toFixed(0)} one-time</td>
                  <td className="px-4 py-2.5 text-xs text-[var(--muted)]">
                    {pk.stripePriceId ?? "not published"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <PublishButton />
          <span className="text-sm text-[var(--muted)]">
            Credit rates: v{rate?.version ?? "—"}
          </span>
        </div>

        {/* Grant a plan for free (comp) */}
        <h2 className="mt-12 text-sm font-semibold">Grant plan (comp)</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Put an org on a paid plan for free — a non-Stripe subscription with the plan&rsquo;s
          monthly credits. Leave <em>months</em> blank for an indefinite comp; a number
          lapses it to Free after ~N months. Downgrade a comp from the org&rsquo;s own billing
          page.
        </p>
        <GrantPlanForm
          orgs={orgs.map((o) => ({
            id: o.id,
            label: `${o.name} (${o.slug}) — ${o.status ?? "free"}`,
          }))}
          plans={plans
            .filter((p) => p.key !== "free" && p.key !== "trial")
            .map((p) => ({
              key: p.key,
              label: `${p.name} · ${(p.includedMonthlyCredits ?? 0).toLocaleString()} cr/mo`,
            }))}
        />

        {/* Credit adjustment */}
        <h2 className="mt-12 text-sm font-semibold">Adjust credits (support)</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Writes an <code>adjustment</code> ledger entry with your user id and the reason —
          the only manual credit mutation there is.
        </p>
        <AdjustCreditsForm
          orgs={orgs.map((o) => ({
            id: o.id,
            label: `${o.name} (${o.slug}) — ${o.status ?? "free"} · ${(
              (o.trial ?? 0) + (o.monthly ?? 0) + (o.pack ?? 0)
            ).toLocaleString()} cr`,
          }))}
        />

        {/* Recent webhook events */}
        <h2 className="mt-12 text-sm font-semibold">Recent Stripe events</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[rgba(var(--ink-rgb),0.08)]">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="px-4 py-2.5 font-normal">Received</th>
                <th className="px-4 py-2.5 font-normal">Type</th>
                <th className="px-4 py-2.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td colSpan={3} className="px-4 py-3 text-[var(--muted)]">
                    No webhook events yet.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td className="px-4 py-2.5 text-[var(--muted)]">
                    {dateFmt.format(e.receivedAt)}
                  </td>
                  <td className="px-4 py-2.5">{e.type}</td>
                  <td className="px-4 py-2.5">
                    {e.error ? (
                      <span className="text-red-400" title={e.error}>
                        failed
                      </span>
                    ) : e.processedAt ? (
                      <span className="text-emerald-400">processed</span>
                    ) : (
                      <span className="text-[var(--muted)]">pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PlatformShell>
  );
}
