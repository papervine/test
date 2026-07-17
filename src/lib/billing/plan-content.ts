import { Rocket, Users, Zap, Briefcase, type LucideIcon } from "lucide-react";
import rawCatalog from "./catalog.json";

// Marketing view over THE catalog (catalog.json). The tier feature bullets, comparison
// matrix, and positioning are read from `plans[].display`, `matrix`, and `positioning`
// there — one file to edit. This module just shapes that data for the /pricing page and
// the in-app Settings→Billing surface, DERIVING the price strings from prices[] (so a
// price change updates the cards automatically) and mapping icon names to components.
// A bad edit (unknown icon, matrix column that isn't a plan) fails at module load, so
// typecheck/tests catch it — not production.

export type PlanKey = "free" | "team" | "pro" | "enterprise";

// Icon names allowed in catalog.json plans[].display.icon → the lucide component.
const ICONS: Record<string, LucideIcon> = { Rocket, Users, Zap, Briefcase };

export type PlanTier = {
  key: PlanKey;
  icon: LucideIcon;
  name: string;
  price: string;
  priceNote: string | null;
  blurb: string;
  badge: string | null;
  highlight: boolean;
  cta: { label: string; href: string };
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
    cta: { label: string; href: string };
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
// ("$0", "Contact us") uses that verbatim; otherwise the monthly price becomes "$50"
// and the annual becomes the "/mo · $40/mo billed annually" note.
function priceDisplay(
  planKey: string,
  override: string | null,
): { price: string; priceNote: string | null } {
  if (override) return { price: override, priceNote: null };
  const month = raw.prices.find((p) => p.planKey === planKey && p.interval === "month");
  const year = raw.prices.find((p) => p.planKey === planKey && p.interval === "year");
  if (!month) fail(`plan '${planKey}' has no price and no display.priceOverride`);
  const price = `$${Math.round(month.unitAmountCents / 100)}`;
  const priceNote = year
    ? `/mo · $${Math.round(year.unitAmountCents / 1200)}/mo billed annually`
    : "/mo";
  return { price, priceNote };
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
      lead: d.lead,
      features: d.features,
    };
  });

export const PLAN_TIER_BY_KEY: Record<PlanKey, PlanTier> = Object.fromEntries(
  PLAN_TIERS.map((t) => [t.key, t]),
) as Record<PlanKey, PlanTier>;

// Enterprise CTA href, surfaced for hosts that render their own contact button.
export const CONTACT_HREF =
  PLAN_TIER_BY_KEY.enterprise?.cta.href ??
  "mailto:support@papervine.io?subject=Papervine%20Enterprise";

// Matrix column headers, in the same order as the tier cards.
export const MATRIX_TIERS = PLAN_TIERS.map((t) => ({
  key: t.key,
  name: t.name,
  icon: t.icon,
}));

const MATRIX_KEYS: PlanKey[] = ["free", "team", "pro", "enterprise"];

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
