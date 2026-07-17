import { ChevronRight, Check, Plus, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { requireSite } from "@/lib/dashboard-context";
import { canSee } from "@/lib/features";
import {
  deriveBillingState,
  getBillingSummary,
  getPlanOffers,
} from "@/lib/billing/summary";
import { PLAN_TIER_BY_KEY, type PlanKey } from "@/lib/billing/plan-content";
import { BillingActions, CancelPlanButton } from "@/components/billing/BillingActions";
import { PlanMatrix } from "@/components/billing/PlanMatrix";

// Billing settings (SPEC §10 Billing) — the plan/subscription surface: current plan +
// change-plan cards + Stripe portal + downgrade. Credit meter/usage moved to the sibling
// Usage surface. Billing is ORG-level (one subscription per org); the page lives under a
// site's Settings only for IA — data is resolved by org, and every site's Billing tab
// shows the same org subscription.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function BillingSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { org, role } = await requireSite(orgSlug, siteSlug);
  const canManage = canSee("admin", role);

  const summary = await getBillingSummary(org.id);
  const offers = await getPlanOffers();
  const { sub } = summary;
  const { trial, effectivePlanName, onPaidPlan, isLivePaid } = deriveBillingState(
    summary,
    new Date(),
  );

  const statusLabel =
    trial.state === "active"
      ? `Trial — ${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left`
      : trial.state === "expired" || !sub || sub.status === "canceled"
        ? "No subscription"
        : sub.status === "past_due"
          ? "Past due — check your payment method"
          : sub.cancelAtPeriodEnd && sub.currentPeriodEnd
            ? `Cancels ${dateFmt.format(sub.currentPeriodEnd)}`
            : sub.currentPeriodEnd
              ? `Renews ${dateFmt.format(sub.currentPeriodEnd)}`
              : "Active";

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Billing</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Billing</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        The plan for {org.name} — it covers every site in this organization.
      </p>

      {/* Current plan */}
      <div className="mt-8 max-w-4xl rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-5">
        <div className="text-sm text-[var(--muted)]">Current plan</div>
        <div className="mt-1 text-2xl font-semibold">{effectivePlanName}</div>
        <div className="mt-1 text-sm text-[var(--muted)]">{statusLabel}</div>
        {trial.state === "active" && (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Your trial includes everything. Pick a plan before{" "}
            {dateFmt.format(trial.endsAt)} to keep AI features on.
          </p>
        )}
        {onPaidPlan && (
          <BillingActions orgSlug={orgSlug} canManage={canManage} kind="portal" />
        )}
        {/* Downgrade/resume shows for ANY live paid state, Stripe-backed or not
            (seed/support-granted subs have no portal but still need an exit). */}
        {isLivePaid && sub && (
          <CancelPlanButton
            orgSlug={orgSlug}
            canManage={canManage}
            cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
            periodEndLabel={
              sub.currentPeriodEnd ? dateFmt.format(sub.currentPeriodEnd) : null
            }
          />
        )}
      </div>

      {/* Plans */}
      <div className="mt-12 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Plans</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Upgrade or change your plan.</p>
        </div>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
        >
          View pricing page
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-4 grid max-w-4xl gap-4 md:grid-cols-2">
        {offers.map((offer) => {
          // Feature bullets come from the shared plan content (same copy as /pricing).
          const content = PLAN_TIER_BY_KEY[offer.planKey as PlanKey];
          return (
            <div
              key={offer.planKey}
              className="flex flex-col rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-5"
            >
              <div className="flex items-baseline justify-between">
                <div className="text-lg font-semibold">{offer.planName}</div>
                {offer.monthlyCents !== undefined && (
                  <div className="text-sm text-[var(--muted)]">
                    <span className="text-xl font-semibold text-[var(--fg)]">
                      ${Math.round(offer.monthlyCents / 100)}
                    </span>
                    /mo
                    {offer.yearlyCents !== undefined && (
                      <> · ${Math.round(offer.yearlyCents / 1200)}/mo annual</>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{offer.blurb}</p>

              {content && (
                <ul className="mt-4 flex flex-col gap-2.5 text-sm">
                  {content.lead && (
                    <li className="flex items-center gap-2.5 font-medium">
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--blue)]/15">
                        <Plus className="h-3 w-3 text-[var(--blue)]" />
                      </span>
                      {content.lead}
                    </li>
                  )}
                  {content.features.map((label) => (
                    <li key={label} className="flex items-center gap-2.5">
                      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--blue)]" />
                      {label}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto pt-5">
                <BillingActions
                  orgSlug={orgSlug}
                  canManage={canManage}
                  kind="plan"
                  planKey={offer.planKey}
                  isCurrent={onPaidPlan && sub?.planKey === offer.planKey}
                />
              </div>
            </div>
          );
        })}
        {offers.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            No plans published yet — run <code>npm run billing:sync</code>.
          </p>
        )}
      </div>

      {/* Full comparison — the same matrix as /pricing, all four tiers incl. Free +
          Enterprise (which aren't purchasable cards above). */}
      <h2 className="mt-12 text-sm font-semibold">Compare plans</h2>
      <div className="mt-4">
        <PlanMatrix />
      </div>
    </div>
  );
}
