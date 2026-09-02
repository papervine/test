import { Rocket, Users, Zap, Briefcase, Code, Building2, type LucideIcon } from "lucide-react";
import rawCatalog from "./catalog.json";

// Marketing view over THE catalog (catalog.json). The tier feature bullets, comparison
// matrix, and positioning are read from `plans[].display`, `matrix`, and `positioning`
// there — one file to edit. This module just shapes that data for the /pricing page and
// the in-app Settings→Billing surface, DERIVING the price strings from prices[] (so a
// price change updates the cards automatically) and mapping icon names to components.
// A bad edit (unknown icon, matrix column that isn't a plan) fails at module load, so
// typecheck/tests catch it — not production.

// The five columns of the comparison matrix. `selfhost` is a card and a matrix column
// but NOT a purchasable plan — it has no prices[] rows and is listed:false, which is why
// the pricing page pulls it out of the tier grid (see HOSTED_TIERS below).
export type PlanKey = "selfhost" | "free" | "team" | "pro" | "enterprise";

// Icon names allowed in catalog.json plans[].display.icon → the lucide component.
// 5-column layout: Selfhost (Code), Cloud/Free (Rocket), Team (Users), Pro (Zap), Enterprise (Building2)
const ICONS: Record<string, LucideIcon> = { Rocket, Users, Zap, Briefcase, Code, Building2 };

// A card CTA. `brand` swaps the plain label for a wordmark button (the GitHub mark, the
// Vercel triangle) — these are third-party logos, so they're inline SVG in the page rather
// than lucide glyphs, and the catalog only names which one.
export type BrandMark = "github" | "vercel";
export const BRAND_MARKS: readonly BrandMark[] = ["github", "vercel"] as const;
export type PlanCta = { label: string; href: string; brand?: BrandMark };

export type PlanTier = {
  key: PlanKey;
  icon: LucideIcon;
  name: string;
  price: string;
  priceNote: string | null;
  blurb: string;
  badge: string | null;
  highlight: boolean;
  cta: PlanCta;
  // A second, lower-emphasis button under the CTA. Self-host pairs "Star on GitHub" with
  // "Deploy with Vercel"; every other tier has one call to action and leaves this null.
  secondaryCta: PlanCta | null;
  lead: string | null;
  features: string[];
};

export type PlanCell = boolean | string;
export type MatrixRow = { label: string } & Record<PlanKey, PlanCell>;
export type MatrixGroup = { group: string; rows: MatrixRow[] };
export type Positioning = { title: string; body: string };

// --- raw shapes we read out of catalog.json (loose; validated below) ---
type RawPlan = {
  key: string;
  name: string;
  blurb: string;
  sort: number;
  display?: {
    icon: string;
    badge: string | null;
    highlight: boolean;
    priceOverride: string | null;
    cta: PlanCta;
    secondaryCta?: PlanCta | null;
    lead: string | null;
    features: string[];
  };
};
type RawPrice = { planKey: string; interval: "month" | "year"; unitAmountCents: number };
const raw = rawCatalog as unknown as {
  plans: RawPlan[];
  prices: RawPrice[];
  positioning: Positioning[];
  matrix: MatrixGroup[];
};

function fail(msg: string): never {
  throw new Error(`billing/catalog.json (plan content) invalid: ${msg}`);
}

// Derive the card price + note from prices[]. A plan with a display.priceOverride
// ("$0", "Contact us") uses that verbatim; otherwise the monthly price becomes "$65"
// and the note is a bare "/mo". The annual price is still in prices[] and still sold —
// the cards just quote one number, so the headline stays legible; the annual discount
// is surfaced at checkout and on the in-app billing page instead.
function priceDisplay(
  planKey: string,
  override: string | null,
): { price: string; priceNote: string | null } {
  if (override) return { price: override, priceNote: null };
  const month = raw.prices.find((p) => p.planKey === planKey && p.interval === "month");
  if (!month) fail(`plan '${planKey}' has no price and no display.priceOverride`);
  return { price: `$${Math.round(month.unitAmountCents / 100)}`, priceNote: "/mo" };
}

// The listed tier cards (plans that carry a `display` block), in sort order. `trial`
// has no display, so it's naturally excluded.
export const PLAN_TIERS: PlanTier[] = raw.plans
  .filter((p) => p.display)
  .sort((a, b) => a.sort - b.sort)
  .map((p) => {
    const d = p.display!;
    const icon = ICONS[d.icon];
    if (!icon) fail(`plan '${p.key}': unknown display.icon '${d.icon}'`);
    for (const cta of [d.cta, d.secondaryCta]) {
      if (cta?.brand && !BRAND_MARKS.includes(cta.brand))
        fail(`plan '${p.key}': unknown cta.brand '${cta.brand}'`);
    }
    const { price, priceNote } = priceDisplay(p.key, d.priceOverride);
    return {
      key: p.key as PlanKey,
      icon,
      name: p.name,
      price,
      priceNote,
      blurb: p.blurb,
      badge: d.badge,
      highlight: d.highlight,
      cta: d.cta,
      secondaryCta: d.secondaryCta ?? null,
      lead: d.lead,
      features: d.features,
    };
  });

export const PLAN_TIER_BY_KEY: Record<PlanKey, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((t) => [t.key, t]),
) as Record<PlanKey, PlanTier>;

// Self-host is a different KIND of offer — OSS, no account, GitHub/Vercel CTAs instead of
// signup — so the pricing page gives it a full-width band of its own and keeps the grid to
// the four hosted tiers people actually choose between. The matrix below still carries all
// five columns; that's where the feature-by-feature comparison belongs.
export const SELFHOST_TIER: PlanTier | null =
  PLAN_TIERS.find((t) => t.key === "selfhost") ?? null;
export const HOSTED_TIERS: PlanTier[] = PLAN_TIERS.filter((t) => t.key !== "selfhost");

// Enterprise CTA href, surfaced for hosts that render their own contact button.
export const CONTACT_HREF =
  PLAN_TIER_BY_KEY.enterprise?.cta.href ??
  "mailto:hello@papervine.io?subject=Papervine%20Enterprise";

// Matrix column headers, in the same order as the tier cards.
export const MATRIX_TIERS = PLAN_TIERS.map((t) => ({
  key: t.key,
  name: t.name,
  icon: t.icon,
}));

const MATRIX_KEYS: PlanKey[] = ["selfhost", "free", "team", "pro", "enterprise"];

export const PLAN_MATRIX: MatrixGroup[] = raw.matrix;
// Validate every matrix row covers exactly the four tier columns.
for (const { group, rows } of PLAN_MATRIX) {
  for (const row of rows) {
    for (const k of MATRIX_KEYS) {
      if (!(k in row)) fail(`matrix '${group}' row '${row.label}' missing column '${k}'`);
    }
  }
}

export const POSITIONING: Positioning[] = raw.positioning;
