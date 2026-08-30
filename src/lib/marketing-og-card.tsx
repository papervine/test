import { readFileSync } from "node:fs";
import path from "node:path";
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

// The hero gradient, matched to the accent word on the landing page.
const BLUE = "#5b8cff";
const VIOLET = "#a974ff";

/**
 * The real logomark, inlined.
 *
 * satori cannot resolve `@/assets/…` the way the app does — a static import gives it a
 * Next-rewritten URL that means nothing inside the renderer — and a relative URL would need a
 * network round trip to ourselves mid-render. Reading the bytes once at module scope and handing
 * over a data URI is the only form that always works, in dev and on a cold serverless instance.
 *
 * The card used to draw a gradient rounded square here instead, which read as a placeholder
 * because that is exactly what it was.
 */
const LOGO_DATA_URI = (() => {
  try {
    const file = path.join(process.cwd(), "src/assets/papervine-logo.png");
    return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  } catch {
    // A card with no mark still unfurls; one that throws during render does not.
    return null;
  }
})();

/** The same four-pointed glint the hero uses (SparklesText), at OG scale. */
const SPARKLE_PATH =
  "M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z";

/** Hand-placed around the headline, clear of the glyphs so nothing sits on a letter. */
const SPARKLES = [
  { left: -34, top: 4, size: 26, color: VIOLET },
  { left: 250, top: -34, size: 18, color: BLUE },
  { left: 618, top: 92, size: 22, color: VIOLET },
  { left: 742, top: -18, size: 16, color: BLUE },
];

/** The hero's three calls to action, drawn rather than described. */
function Buttons(): ReactElement {
  const pill = {
    display: "flex",
    alignItems: "center",
    height: 62,
    paddingLeft: 28,
    paddingRight: 28,
    borderRadius: 14,
    fontSize: 26,
  } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: 44 }}>
      <div
        style={{
          ...pill,
          backgroundImage: `linear-gradient(120deg, ${BLUE} 0%, ${VIOLET} 100%)`,
          color: "#ffffff",
        }}
      >
        Join Waitlist
      </div>
      <div
        style={{
          ...pill,
          marginLeft: 18,
          color: "#ececf1",
          border: "1px solid rgba(236,236,241,0.18)",
        }}
      >
        <svg width={17} height={15} viewBox="0 0 76 65" style={{ marginRight: 12 }}>
          <path d="M38 0 76 65H0Z" fill="#ececf1" />
        </svg>
        Deploy
      </div>
      <div
        style={{
          ...pill,
          marginLeft: 18,
          color: "#ececf1",
          border: "1px solid rgba(236,236,241,0.18)",
        }}
      >
        <svg width={22} height={22} viewBox="0 0 24 24" style={{ marginRight: 12 }}>
          <path
            d="M12 2.5l2.6 6.1 6.6.6-5 4.3 1.5 6.5L12 16.6 6.3 20l1.5-6.5-5-4.3 6.6-.6L12 2.5Z"
            fill="#ececf1"
          />
        </svg>
        Star
      </div>
    </div>
  );
}

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
   * paints the accent word.
   */
  headline: Array<Array<string | { accent: string }>>;
  /** Sub-lines, authored one per rendered line. */
  sublines: string[];
  /**
   * Draw the hero's three calls to action. Opt-in, because this card is shared with /pricing,
   * whose card has its own story to tell — a "Join Waitlist / Deploy / Star" row there would be
   * advertising the wrong page.
   */
  buttons?: boolean;
};

export function MarketingOgCard({
  headline,
  sublines,
  buttons = false,
}: MarketingOgCard): ReactElement {
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
        {LOGO_DATA_URI ? (
          // eslint-disable-next-line @next/next/no-img-element -- satori renders raw <img>; this
          // is not the DOM and next/image has no meaning here.
          <img src={LOGO_DATA_URI} width={44} height={44} alt="" style={{ marginRight: 18 }} />
        ) : null}
        <div style={{ display: "flex", fontSize: 34, color: "#ececf1", letterSpacing: -0.4 }}>
          Papervine
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
        {SPARKLES.map((sp, i) => (
          <svg
            key={`sp${i}`}
            width={sp.size}
            height={sp.size}
            viewBox="0 0 24 24"
            style={{ position: "absolute", left: sp.left, top: sp.top }}
          >
            <path d={SPARKLE_PATH} fill={sp.color} />
          </svg>
        ))}
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
        {buttons ? <Buttons /> : null}
      </div>

      <div style={{ display: "flex", fontSize: 28, color: "#61616c" }}>{domains.platform}</div>
    </div>
  );
}
