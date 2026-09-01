import { CreditCard, ArrowUpRight } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/dashboard-context";
import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { fetchPlans, AI_CREDITS_FEATURE } from "@/lib/billing/autumn";
import { AdminPage } from "../ui";
import { AdjustCreditsForm, GrantPlanForm } from "./AdminBillingActions";

// Platform-admin billing console (SPEC §10 Billing; same §10.10 gate as /admin). The
// catalog is READ-ONLY here and always was — what changed is where it comes from. It used
// to be src/lib/billing/catalog.json pushed into Postgres by `billing:sync`, with a button
// on this page to publish it onward to Stripe. Autumn holds the catalog and provisions
// Stripe from it, so this page mirrors Autumn and links out to edit; the publish button
// and the Stripe webhook-event log both retired with the machinery they reported on.
//
// What's left is the part only we can do: the two support levers, comp a plan and adjust
// credits.
export const dynamic = "force-dynamic";

const AUTUMN_DASHBOARD = "https://app.useautumn.com";

function money(cents: number | undefined): string {
  return typeof cents === "number" ? `$${(cents / 100).toFixed(0)}` : "—";
}

export default async function AdminBillingPage() {
  await requirePlatformAdmin();

  const [plans, orgs] = await Promise.all([
    fetchPlans(),
    // Orgs are ours; their billing state is Autumn's, and fetching it per row would be one
    // API call per organization on a page that only needs to label a picker.
    db
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .orderBy(organization.name),
  ]);

  const orgOptions = orgs.map((o) => ({ id: o.id, label: `${o.name} (${o.slug})` }));
  const credits = (plan: (typeof plans)[number]) =>
    (plan.items ?? []).find((i) => i.feature_id === AI_CREDITS_FEATURE)?.included ?? 0;

  return (
    <AdminPage>
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <CreditCard className="h-5 w-5" /> Billing
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Plans, prices and entitlements live in Autumn, which provisions Stripe from them —
          editing a plan there IS the publish. This console mirrors what Autumn holds and
          gives support its two levers.
        </p>

        {/* Catalog, as Autumn holds it */}
        <div className="mt-10 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Catalog (from Autumn)</h2>
          <a
            href={AUTUMN_DASHBOARD}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            Edit in Autumn
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-[rgba(var(--ink-rgb),0.08)]">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)]">
                <th className="px-4 py-2.5 font-normal">Plan</th>
                <th className="px-4 py-2.5 font-normal">Id</th>
                <th className="px-4 py-2.5 font-normal">Credits</th>
                <th className="px-4 py-2.5 font-normal">Price</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 && (
                <tr className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td colSpan={4} className="px-4 py-3 text-[var(--muted)]">
                    No catalog — AUTUMN_SECRET_KEY is unset or Autumn is unreachable.
                  </td>
                </tr>
              )}
              {plans.map((p) => (
                <tr key={p.id} className="border-t border-[rgba(var(--ink-rgb),0.06)]">
                  <td className="px-4 py-2.5 font-medium">
                    {p.name ?? p.id}
                    {p.add_on && (
                      <span className="ml-2 text-xs text-[var(--muted)]">pack</span>
                    )}
                    {p.variant_details?.base_plan_id && (
                      <span className="ml-2 text-xs text-[var(--muted)]">
                        variant of {p.variant_details.base_plan_id}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--muted)]">{p.id}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {credits(p).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.price?.amount
                      ? `${money(Math.round(p.price.amount * 100))}/${
                          p.price.interval === "month"
                            ? "mo"
                            : p.price.interval === "year"
                              ? "yr"
                              : "one-time"
                        }`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Grant a plan for free (comp) */}
        <h2 className="mt-12 text-sm font-semibold">Grant plan (comp)</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Put an org on a paid plan for free — Autumn grants the entitlements and bills
          nothing. Leave <em>months</em> blank for an indefinite comp; a number ends it after
          ~N months. Downgrade a comp from the org&rsquo;s own billing page.
        </p>
        <GrantPlanForm
          orgs={orgOptions}
          plans={plans
            .filter((p) => !p.add_on && p.price?.amount)
            .map((p) => ({
              key: p.id,
              label: `${p.name ?? p.id} · ${credits(p).toLocaleString()} cr`,
            }))}
        />

        {/* Credit adjustment */}
        <h2 className="mt-12 text-sm font-semibold">Adjust credits (support)</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Grants (or claws back) AI credits on an org&rsquo;s balance. A reason is still
          required, but it lands in Autumn&rsquo;s balance history rather than a ledger row
          carrying your user id — see the SPEC note on what that trade costs.
        </p>
        <AdjustCreditsForm orgs={orgOptions} />
      </div>
    </AdminPage>
  );
}
