"use server";

// Billing server actions (SPEC §10 Billing). Autumn is the source of truth: these never
// write subscription state themselves, they ask Autumn to make the change and it drives
// Stripe. Every action returns `{ ok, redirectTo }` for the client to
// window.location.assign(): Checkout/Portal are cross-origin, and the dashboard's own
// return paths ride the app-host Host-rewrite that a server-action redirect() would skip
// (the repo's hard-navigation gotcha).
import { headers } from "next/headers";
import { getSession, listOrganizations, getMemberRole } from "@/lib/session";
import { canSee } from "@/lib/features";
import {
  attachPlan,
  autumnConfigured,
  billingPortalUrl,
  ensureCustomer,
  setCancelation,
  setOverage,
} from "@/lib/billing/autumn";

type ActionResult = { ok: true; redirectTo: string } | { ok: false; error: string };

const NOT_CONFIGURED = "Billing isn't configured on this deployment yet.";

/** Resolve + authorize: signed-in owner/admin of the org. Billing is money — member
 *  and viewer roles can look at the page but not act (enforced here, not just hidden). */
type ManagerContext =
  | { ok: false; error: string }
  | {
      ok: true;
      session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
      org: { id: string; slug: string };
    };

async function requireBillingManager(orgSlug: string): Promise<ManagerContext> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Signed out." };
  const org = (await listOrganizations())?.find((o) => o.slug === orgSlug);
  if (!org) return { ok: false, error: "Organization not found." };
  const role = await getMemberRole(org.id, session.user.id);
  if (!canSee("admin", role))
    return { ok: false, error: "Only owners and admins can manage billing." };
  return { ok: true, session, org: { id: org.id, slug: org.slug } };
}

/** The app-host origin for return URLs, derived from the live request Host so dev ports
 *  and preview deploys round-trip correctly. */
async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.papervine.io";
  const proto = host.includes("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Buy or switch to a plan. One path now: Autumn decides whether this is a new
 * subscription, an upgrade to prorate in place, or a downgrade to schedule, and hands back
 * a Checkout URL only when it actually needs a card. The old fork — "live Stripe sub gets
 * subscriptions.update, everyone else gets Checkout" — was us reimplementing that decision.
 *
 * `changed: true` means it applied without leaving the dashboard (the client refreshes).
 */
export async function changePlan(
  orgSlug: string,
  planId: string,
): Promise<{ ok: true; changed: true } | ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!autumnConfigured()) return { ok: false, error: NOT_CONFIGURED };

  // The customer may not exist yet (org created before billing, or a failed signup hook).
  await ensureCustomer({
    organizationId: ctx.org.id,
    email: ctx.session.user.email,
    name: ctx.session.user.name,
  });

  const base = await appOrigin();
  const res = await attachPlan({
    organizationId: ctx.org.id,
    planId,
    successUrl: `${base}/${orgSlug}/billing?checkout=success`,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Could not change the plan." };
  return res.checkoutUrl
    ? { ok: true, redirectTo: res.checkoutUrl }
    : { ok: true, changed: true };
}

/** Buy a one-time credit pack. Packs are add-on plans, so this is the same attach. */
export async function startPackCheckout(
  orgSlug: string,
  packId: string,
): Promise<ActionResult> {
  const result = await changePlan(orgSlug, packId);
  if ("changed" in result) {
    // A pack that needed no payment (a comped customer, a zero-price pack) applied
    // straight away — send the client back to the page it came from.
    return { ok: true, redirectTo: `${await appOrigin()}/${orgSlug}/billing?pack=success` };
  }
  return result;
}

/** Autumn's hosted portal (Stripe's, provisioned by Autumn): cards, invoices, receipts. */
export async function openBillingPortal(orgSlug: string): Promise<ActionResult> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!autumnConfigured()) return { ok: false, error: NOT_CONFIGURED };
  const base = await appOrigin();
  const url = await billingPortalUrl({
    organizationId: ctx.org.id,
    returnUrl: `${base}/${orgSlug}/billing`,
  });
  if (!url) return { ok: false, error: "No billing account yet — subscribe to a plan first." };
  return { ok: true, redirectTo: url };
}

/**
 * Downgrade to Free (cancel at period end) or resume. Previously this branched on whether
 * the subscription had a Stripe object behind it, with an hourly sweep acting as the
 * period-end biller for the ones that didn't. Autumn bills everything it manages, so both
 * halves collapse into one call and the sweep retires with them.
 */
export async function setPlanCancelation(
  orgSlug: string,
  cancel: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!autumnConfigured()) return { ok: false, error: NOT_CONFIGURED };
  return setCancelation({ organizationId: ctx.org.id, cancel });
}

/** The overage opt-in (hard caps by default — SPEC §10 Billing rule 4). Org-level and
 *  deliberate: flipping it on is the only way usage can exceed the included credits. */
export async function setOverageEnabled(
  orgSlug: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireBillingManager(orgSlug);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!autumnConfigured()) return { ok: false, error: NOT_CONFIGURED };
  return setOverage({ organizationId: ctx.org.id, enabled });
}
