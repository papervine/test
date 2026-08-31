import { ImageResponse } from "next/og";
import { MarketingOgCard, MARKETING_OG_SIZE } from "@/lib/marketing-og-card";

/**
 * The social card for the comparison page — the one URL on the apex most likely to be pasted
 * into a thread where someone is picking a docs platform, so it earns an image.
 *
 * Deliberately carries **no competitor name and no price**. The card is a PNG that stays
 * cached on every timeline that scraped it: a price would go stale silently (the same reason
 * the pricing card is price-free), and a rival's name rendered into our artwork reads as
 * trading on their brand rather than answering a search — the page itself is where the
 * comparison belongs, under its disclaimer and its sources.
 */

export const alt = "Papervine — your docs.json renders unchanged";
export const size = MARKETING_OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <MarketingOgCard
        // Two short lines on purpose: satori does not wrap, it just runs past the edge, so
        // each line is authored to fit (~24 characters at this size). The first draft's
        // "platforms? Start with the format." overflowed and printed on top of itself.
        headline={[["Pick the format,"], ["not the ", { accent: "feature grid." }]]}
        sublines={[
          "Ten platforms compared, prices from their own pages —",
          "and your existing docs.json renders here unchanged.",
        ]}
      />
    ),
    size,
  );
}
