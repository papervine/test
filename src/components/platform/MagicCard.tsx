"use client";

import { useCallback, useRef, type ReactNode } from "react";

/**
 * A card whose border and interior light up under the cursor.
 *
 * MagicUI's MagicCard effect, implemented here rather than pulled from that registry: theirs
 * drives the position through framer-motion's `useMotionValue`/`useMotionTemplate`, and the
 * whole effect is two gradients that need one number each. Writing those numbers to CSS custom
 * properties does the same job with no dependency and no React re-render — the pointer handler
 * touches the DOM node directly, so moving the mouse over a login form doesn't re-render the
 * form on every frame.
 *
 * Two stacked layers, both decorative and both `pointer-events-none` so they never intercept a
 * click meant for the inputs underneath:
 *
 *  - the BORDER, a gradient clipped to a 1px ring by an xor mask (paint the padding box and the
 *    content box, then exclude the second — the standard way to get a gradient border without a
 *    wrapper element that would round differently from its child), and
 *  - the SPOTLIGHT, a soft radial wash over the card's surface.
 *
 * Deliberately no `overflow-hidden`: the card holds text inputs, and clipping would cut off
 * their focus rings. The layers are rounded to match instead.
 */
export function MagicCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);

  const track = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Position in the card's own space, so the gradients follow the pointer regardless of
    // where the card sits on screen or how far the page is scrolled.
    el.style.setProperty("--pv-mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--pv-my", `${e.clientY - rect.top}px`);
  }, []);

  const reset = useCallback(() => {
    // Park the light off-card rather than at the centre: fading out from wherever the cursor
    // left reads as the light following it away, while snapping to the middle reads as a bug.
    card.current?.style.setProperty("--pv-mx", "-100%");
  }, []);

  return (
    <div
      ref={card}
      onMouseMove={track}
      onMouseLeave={reset}
      className={`pv-magic-card relative ${className ?? ""}`}
    >
      <span aria-hidden className="pv-magic-card-border pointer-events-none absolute inset-0" />
      <span aria-hidden className="pv-magic-card-glow pointer-events-none absolute inset-0" />
      <div className="relative">{children}</div>
    </div>
  );
}
