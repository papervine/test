import type { ReactNode } from "react";

/**
 * Twinkling sparkles scattered over a heading.
 *
 * A CSS/SVG take on MagicUI's SparklesText rather than that component itself, for two reasons
 * specific to where it's used. It sits on the **h1 of the SEO landing** — the LCP element — and
 * the upstream version is a client component driven by framer-motion, which would put a
 * animation library on the critical path of the page this repo works hardest to keep light
 * (the backdrop is pure SVG/CSS for the same reason, and the tour is click-to-play). And its
 * sparkle positions come from `Math.random()` in an effect; deterministic positions let this
 * stay a **server component**, so the headline text is in the server HTML with no hydration
 * step and nothing to mismatch.
 *
 * The look follows the original: small four-pointed stars in two colours, each twinkling on its
 * own staggered cycle. The colours are our brand tokens, so they track the gradient in the
 * headline and follow the light/dark appearance for free.
 */

/**
 * Fixed sparkle placements. Deliberately hand-placed rather than generated: they avoid the
 * descenders and the middle of words (a star sitting on a letter reads as a rendering bug),
 * cluster toward the ends of the line where there's whitespace, and — being constant — render
 * identically on the server and the client.
 *
 * `left`/`top` are percentages of the heading box, so they scale with the responsive type.
 */
const SPARKLES = [
  { left: "-2%", top: "18%", size: 19, delay: "0s", duration: "3.2s", tone: "violet" },
  { left: "12%", top: "-12%", size: 14, delay: "1.1s", duration: "2.8s", tone: "blue" },
  { left: "31%", top: "84%", size: 17, delay: "2.0s", duration: "3.6s", tone: "blue" },
  { left: "44%", top: "-16%", size: 22, delay: "0.6s", duration: "3.0s", tone: "violet" },
  { left: "58%", top: "92%", size: 13, delay: "2.6s", duration: "2.6s", tone: "violet" },
  { left: "69%", top: "-8%", size: 17, delay: "1.6s", duration: "3.4s", tone: "blue" },
  { left: "83%", top: "70%", size: 19, delay: "0.3s", duration: "2.9s", tone: "violet" },
  { left: "95%", top: "8%", size: 15, delay: "2.2s", duration: "3.3s", tone: "blue" },
  { left: "101%", top: "58%", size: 13, delay: "1.4s", duration: "2.7s", tone: "blue" },
  { left: "24%", top: "100%", size: 14, delay: "3.0s", duration: "3.1s", tone: "violet" },
] as const;

export function SparklesText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`pv-sparkles relative inline-block ${className ?? ""}`}>
      {/* Decorative only: the heading's text is the accessible content, and a screen reader
          gains nothing from ten stars. Not clipped by the box — several sit deliberately
          outside it — so the layer must not intercept pointer events. */}
      <span aria-hidden className="pointer-events-none absolute inset-0">
        {SPARKLES.map((s, i) => (
          <svg
            key={i}
            className="pv-sparkle absolute"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
              animationDuration: s.duration,
              color: s.tone === "blue" ? "var(--blue)" : "var(--violet)",
            }}
            viewBox="0 0 24 24"
            fill="none"
          >
            {/* The four-pointed star: concave curves between the points, so it reads as a
                glint rather than a plus sign. */}
            <path
              d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z"
              fill="currentColor"
            />
          </svg>
        ))}
      </span>
      {children}
    </span>
  );
}
