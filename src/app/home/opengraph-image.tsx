import { ImageResponse } from "next/og";
import { MarketingOgCard, MARKETING_OG_SIZE } from "@/lib/marketing-og-card";

/**
 * The social card for the marketing apex (SPEC §2). Sharing papervine.io declared
 * `twitter:card: summary_large_image` with **no image**, which is the one combination that
 * unfurls as nothing at all — the wide card is requested and then has nothing to show.
 *
 * A file-convention metadata route rather than a call into `/api/og`: that route renders a
 * *docs site's* card from a `docs.json`, and the apex has no tenant. Next hashes the URL from
 * this file's content, so the card re-scrapes when the art or the copy changes.
 */

export const alt = "Papervine — the intelligent docs platform";
export const size = MARKETING_OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <MarketingOgCard
        headline={[["Documentation"], ["that ", { accent: "grows" }, " itself."]]}
        sublines={[
          "docs.json-native — your existing docs repo migrates unchanged.",
          "Built for your readers and the AI agents they rely on.",
        ]}
      />
    ),
    size,
  );
}
