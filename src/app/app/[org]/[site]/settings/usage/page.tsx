import { desc, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireSite } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { usageEvent } from "@/lib/db/app-schema";
import { canSee } from "@/lib/features";
import {
  deriveBillingState,
  getBillingSummary,
  getCreditPacks,
} from "@/lib/billing/summary";
import { BillingActions, OverageToggle } from "@/components/billing/BillingActions";
import { RemainingLine, UsageMeter } from "@/components/billing/meters";

// Usage settings (SPEC §10 Billing) — the credit meter, reset date, overage opt-in,
// credit packs, and recent AI usage. Plan/subscription lives on the sibling Billing
// surface. Org-level data (credits belong to the org), resolved via requireSite→org.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function UsageSettingsPage({
  params,
}: {
  params: Promise<{ org: string; site: string }>;
}) {
  const { org: orgSlug, site: siteSlug } = await params;
  const { org, role } = await requireSite(orgSlug, siteSlug);
  const canManage = canSee("admin", role);

  const summary = await getBillingSummary(org.id);
  const { sub, buckets } = summary;
  const { trial, totalCredits, onPaidPlan } = deriveBillingState(summary, new Date());
  const included = sub?.includedMonthlyCredits ?? 0;

  // "Next reset" — when the credit pool refreshes (competitor parity). A paying plan
  // resets its monthly grant at the period boundary; a trial's credits expire when the
  // trial ends; Free has nothing to reset.
  const resetLabel: { label: string; value: string } | null =
    trial.state === "active"
      ? { label: "Trial ends", value: dateFmt.format(trial.endsAt) }
      : included > 0 && sub?.currentPeriodEnd
        ? { label: "Next reset", value: dateFmt.format(sub.currentPeriodEnd) }
        : null;

  const packs = await getCreditPacks();

  const usage = await db
    .select()
    .from(usageEvent)
    .where(eq(usageEvent.organizationId, org.id))
    .orderBy(desc(usageEvent.createdAt))
    .limit(15);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <nav className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <span>Settings</span>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-[var(--fg)]">Usage</span>
      </nav>

      <h1 className="mt-6 text-xl font-semibold">Usage</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        AI credits for {org.name}. Credits are shared across every site.
      </p>

      {/* Credit meter */}
      <div className="mt-8 max-w-2xl rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] p-5">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-[var(--muted)]">AI credits</div>
          <div className="text-2xl font-semibold tabular-nums">
            {totalCredits.toLocaleString()}
            <span className="ml-1.5 text-sm font-normal text-[var(--muted)]">
              remaining
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {buckets.trial > 0 && <RemainingLine label="Trial" value={buckets.trial} />}
          {included > 0 && (
            <UsageMeter
              label="Monthly"
              // Used = included − remaining; a negative balance (overage opt-in) pushes
              // used past included and the bar goes red.
              used={included - buckets.monthly}
              max={included}
            />
          )}
          {buckets.pack > 0 && <RemainingLine label="Packs" value={buckets.pack} />}
          {totalCredits === 0 && included === 0 && buckets.trial === 0 && (
            <p className="text-sm text-[var(--muted)]">
              No AI credits on this plan. Upgrade to Team or Pro for a monthly allowance.
            </p>
          )}
        </div>

        {resetLabel && (
          <div className="mt-4 flex items-center justify-between border-t border-[rgba(var(--ink-rgb),0.06)] pt-4 text-sm">
            <span className="text-[var(--muted)]">{resetLabel.label}</span>
            <span className="font-medium tabular-nums">{resetLabel.value}</span>
          </div>
        )}

        {sub && sub.status !== "canceled" && (
          <OverageToggle
            orgSlug={orgSlug}
            enabled={sub.overageEnabled}
            canManage={canManage}
          />
        )}
      </div>

      {/* Credit packs */}
      {packs.length > 0 && (
        <>
          <h2 className="mt-12 text-sm font-semibold">Credit packs</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            One-time top-ups that never expire. Available on paid plans.
          </p>
          <div className="mt-4 flex max-w-4xl flex-wrap gap-3">
            {packs.map((pack) => (
              <div
                key={pack.key}
                className="flex items-center gap-4 rounded-2xl border border-[rgba(var(--ink-rgb),0.08)] bg-[rgba(var(--ink-rgb),0.03)] px-5 py-4"
              >
                <div>
                  <div className="font-medium">{pack.name}</div>
                  <div className="text-sm text-[var(--muted)]">
                    ${(pack.priceCents / 100).toFixed(0)}
                  </div>
                </div>
                <BillingActions
                  orgSlug={orgSlug}
                  canManage={canManage && onPaidPlan}
                  kind="pack"
                  packKey={pack.key}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recent usage */}
      <h2 className="mt-12 text-sm font-semibold">Recent AI usage</h2>
      {usage.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No AI usage yet this period.</p>
      ) : (
        <div className="mt-4 max-w-4xl overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="py-2 pr-3 font-normal">When</th>
                <th className="py-2 pr-3 font-normal">Operation</th>
                <th className="py-2 pr-3 font-normal">Model</th>
                <th className="py-2 pr-3 text-right font-normal">Tokens</th>
                <th className="py-2 text-right font-normal">Credits</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id} className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td className="py-2 pr-3 text-[var(--muted)]">
                    {dateFmt.format(u.createdAt)}
                  </td>
                  <td className="py-2 pr-3 capitalize">{u.feature}</td>
                  <td className="py-2 pr-3 text-[var(--muted)]">{u.model}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-[var(--muted)]">
                    {(u.tokensIn + u.tokensOut).toLocaleString()}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">{u.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
