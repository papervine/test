import { ImageResponse } from "next/og";
import { MarketingOgCard, MARKETING_OG_SIZE } from "@/lib/marketing-og-card";

/**
 * The social card for the pricing page — the apex's second-most-shared URL, which until now
 * unfurled with no image at all.
 *
 * Deliberately **price-free**. Plan prices live in the billing catalog and ship through
 * `billing:sync` → `billing:publish` (SPEC §10), so a reprice is a data change with no reason to
 * touch this file — baking "$50" into a PNG would leave a stale card on every timeline that had
 * already scraped it, with nothing to signal it had gone wrong.
 */

export const alt = "Papervine pricing — start with 30 days of everything";
export const size = MARKETING_OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <MarketingOgCard
        // The period rides inside the accent rather than trailing it as its own white span:
        // satori leaves a visible seam after a gradient span, so "everything ." read as a typo.
        headline={[["Start with 30 days"], ["of ", { accent: "everything." }]]}
        sublines={[
          "Then free for small docs sites, with plans that scale",
          "as your team does.",
        ]}
      />
    ),
    size,
  );
}
