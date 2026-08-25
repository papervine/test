import type { ReactElement } from "react";
import { domains } from "./tenant-host";

/**
 * The social card artwork for Papervine's OWN pages (SPEC §2) — the apex landing and pricing.
 *
 * Separate from the tenant card (`@papervine/renderer/lib/og-card`) on purpose: that one renders
 * a *customer's* docs page from their `docs.json`, and the apex has no `docs.json` to read. This
 * one is our storefront, so it's drawn in the landing page's own art direction — near-black
 * ground, blue→violet gradient — with copy passed in per page.
 *
 * Same satori constraints as the tenant card: a flexbox subset only, every element with children
 * needs an explicit `display: flex`, and lines are authored rather than wrapped (satori breaks
 * wherever the box runs out, which left "on." stranded on a line of its own).
 */

// The hero gradient, matched to the `grows` wordmark on the landing page.
const BLUE = "#5b8cff";
const VIOLET = "#a974ff";

export const MARKETING_OG_SIZE = { width: 1200, height: 630 };

/**
 * A headline is split into spans so one word can be painted with the gradient — and satori drops
 * the ASCII space at a span boundary, which rendered "of everything." as "ofeverything .". Author
 * the copy with ordinary spaces; the ones that sit against a boundary become non-breaking here.
 */
function keepEdgeSpacing(text: string): string {
  return text.replace(/^ +| +$/g, (run) => "\u00a0".repeat(run.length));
}

export type MarketingOgCard = {
  /**
   * The headline, as explicit lines. A segment may be `{ accent: "…" }` to paint it with the
   * hero's gradient — satori supports `background-clip: text`, which is how the landing page
   * paints "grows".
   */
  headline: Array<Array<string | { accent: string }>>;
  /** Sub-lines, authored one per rendered line. */
  sublines: string[];
};

export function MarketingOgCard({ headline, sublines }: MarketingOgCard): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#08080c",
        // Anchored off-canvas: satori rasterises a gradient in bands, and a stop landing inside
        // the frame draws that band as a visible arc.
        backgroundImage: `radial-gradient(circle at 50% 125%, ${VIOLET}33 0%, ${VIOLET}00 70%)`,
        padding: "72px 80px",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            backgroundImage: `linear-gradient(135deg, ${BLUE} 0%, ${VIOLET} 100%)`,
            marginRight: 18,
          }}
        />
        <div style={{ display: "flex", fontSize: 34, color: "#ececf1", letterSpacing: -0.4 }}>
          Papervine
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {headline.map((line, i) => (
          <div
            key={i}
            style={{ display: "flex", fontSize: 86, lineHeight: 1.08, letterSpacing: -2.5 }}
          >
            {line.map((part, j) =>
              typeof part === "string" ? (
                <span key={j} style={{ color: "#ffffff" }}>
                  {keepEdgeSpacing(part)}
                </span>
              ) : (
                <span
                  key={j}
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${BLUE} 0%, ${VIOLET} 100%)`,
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {keepEdgeSpacing(part.accent)}
                </span>
              ),
            )}
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
          {sublines.map((line, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                fontSize: 32,
                color: "#8a8a99",
                ...(i ? { marginTop: 8 } : {}),
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#61616c" }}>{domains.platform}</div>
    </div>
  );
}
