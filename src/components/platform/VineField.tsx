// The landing page's ambient backdrop — a living counterpart to the static `.db-grid`
// the other "full" surfaces use. Three vines slowly *draw* themselves upward (an animated
// `stroke-dashoffset`), leaves unfurl in sequence as each vine climbs past them, and a
// glowing bud lights at every growing tip — then the whole thing settles into a barely
// perceptible sway. Pure SVG + CSS (see `.db-vine*` in platform.css), so it stays a server
// component: no JS ships, and `prefers-reduced-motion` collapses it to the grown-in state.
//
// "Papervine" — a vine sprouting from a page. The motion draws the eye up toward the headline.

import { fallKeyframes, fallWindow, lifeKeyframes, simulateLeafFall } from "@/lib/leaf-fall";

// Each strand: its path and the delay before it begins drawing (a staggered sprout).
const VINES = [
  { d: "M600,772 C566,648 648,576 604,452 C566,344 648,300 600,176 C582,108 600,84 600,40", delay: "0s" },
  { d: "M372,772 C356,654 300,604 344,500 C384,404 300,360 360,256 C396,196 358,150 414,96", delay: ".5s" },
  { d: "M828,772 C844,654 900,604 856,500 C816,404 900,360 840,256 C804,196 842,150 786,96", delay: ".5s" },
];

// Leaves sit on the vine curves; each unfurls just as the stroke reaches it (hence the delay,
// tuned to the draw timing). x/y is the leaf base, r its orientation, s a size variation.
//
// Coordinates are SNAPPED to the nearest point on the owning bezier rather than typed by hand.
// Several used to sit up to 29px off their stalk — visibly floating in mid-air — because these
// curves bow a long way from the straight line between their endpoints, so a coordinate that
// looks plausible beside the path data is not necessarily on the path. `r` follows the tangent
// there (turned 90deg onto the blade's own axis, then splayed off the stem).
const LEAVES = [
  // center
  { x: 604, y: 452, r: 25, s: 1.05, delay: 2.2 },
  { x: 596.9, y: 359.3, r: -35, s: 1, delay: 3.1 },
  { x: 613.8, y: 228, r: 37, s: 1.1, delay: 4.2 },
  { x: 594.6, y: 150.9, r: -54, s: 0.9, delay: 5 },
  // left
  { x: 344, y: 500, r: -22, s: 1, delay: 1.9 },
  { x: 350.1, y: 404.5, r: 33, s: 1.05, delay: 2.8 },
  { x: 344.3, y: 290.7, r: -27, s: 1.1, delay: 3.9 },
  { x: 377.7, y: 198.8, r: 50, s: 0.9, delay: 4.8 },
  // right
  { x: 856, y: 500, r: 22, s: 1, delay: 1.9 },
  { x: 849.9, y: 404.5, r: -33, s: 1.05, delay: 2.8 },
  { x: 855.7, y: 290.7, r: 27, s: 1.1, delay: 3.9 },
  { x: 822.3, y: 198.8, r: -50, s: 0.9, delay: 4.8 },
];

// New growth: leaves that come and go rather than unfurling once and staying. Each sprouts,
// holds for most of its cycle, then withers and drops — so the backdrop keeps changing without
// ever announcing itself.
//
// Every x/y here is COMPUTED, not eyeballed: each is a point evaluated on the vine's own cubic
// bezier at a given t, so the leaf base sits exactly on the stalk. Placing them by eye put
// several visibly adrift in mid-air — the curves bow a long way from the straight line between
// their endpoints, so a coordinate that looks right next to the path data is not on the path.
// `r` is derived too: the tangent at that t, turned 90deg to match the blade's own axis, then
// splayed ~45deg off the stalk so it reads as joined rather than glued flat against it.
//
// `dur` and `delay` share no common factor and none repeat: with a shared duration the whole
// field would pulse in unison, which is the one thing that would make it read as an animation
// rather than as a plant.
// `green` marks a leaf that unfurls in leaf-green rather than the brand gradient. Two of the
// nine, and specifically the two with the LONGEST cycles (34s and 33s) — `dur` is the whole
// grow-sit-fall-wait loop, so a longer one leaves a longer bare gap and the green leaf is
// genuinely occasional. Marking two short-cycle leaves instead would have put green on the vine
// almost continuously, which is a different thing entirely.
//
// They're also on opposite strands, so the green never appears twice in the same place.
const NEW_GROWTH = [
  // center
  { x: 608.9, y: 597.3, r: 58, s: 0.85, dur: 23, delay: 2 },
  { x: 602.8, y: 332, r: -30, s: 0.8, dur: 31, delay: 11 },
  { x: 594, y: 93.1, r: 48, s: 0.75, dur: 27, delay: 19 },
  // left
  { x: 338.9, y: 642.9, r: -64, s: 0.8, dur: 29, delay: 6 },
  { x: 344.5, y: 381, r: 31, s: 0.85, dur: 21, delay: 14 },
  { x: 379.5, y: 173.8, r: -38, s: 0.7, dur: 34, delay: 25, green: true },
  // right
  { x: 861.1, y: 642.9, r: 64, s: 0.8, dur: 26, delay: 9 },
  { x: 855.5, y: 381, r: -31, s: 0.85, dur: 33, delay: 17, green: true },
  { x: 820.5, y: 173.8, r: 38, s: 0.7, dur: 24, delay: 3 },
];

// A glowing bud at each growing tip, lit once the strand finishes drawing.
const BUDS = [
  { x: 600, y: 40, delay: 5.6 },
  { x: 414, y: 96, delay: 5.4 },
  { x: 786, y: 96, delay: 5.4 },
];

// A single leaf blade, base at the local origin so it unfurls (scales) from where it joins.
const LEAF = "M0,0 C9,-4 16,-14 8,-28 C5,-18 -6,-11 0,0 Z";

// How each new-growth leaf falls, worked out once here rather than drawn as a curve: gravity
// against air resistance, the blade catching more air broadside than edge-on, lift, a little
// wind. See src/lib/leaf-fall.ts. Each leaf gets its own pair of keyframes — the fall (a
// screen-space translate + tumble) and the life around it (unfurl, hold, dark once out of
// frame) — because a leaf near the top has three times as far to fall as one near the bottom,
// and the release point has to move to make room. The viewBox is 760 tall; the frame the
// leaves fall out of is taller than that on tall windows (`xMidYMin slice`), so the floor sits
// well below it.
const FALL_FLOOR = 900;
const GROWTH = NEW_GROWTH.map((l, i) => {
  const samples = simulateLeafFall({ seed: i, blade: l.r, startY: l.y, floorY: FALL_FLOOR });
  const window = fallWindow(samples[samples.length - 1].t, l.dur);
  return {
    ...l,
    fall: `db-leaf-fall-${i}`,
    life: `db-leaf-life-${i}`,
    css: fallKeyframes(`db-leaf-fall-${i}`, samples, window) + lifeKeyframes(`db-leaf-life-${i}`, window),
  };
});
const GROWTH_CSS = GROWTH.map((g) => g.css).join("");

export function VineField() {
  return (
    <div className="db-vine" aria-hidden="true">
      <svg viewBox="0 0 1200 760" preserveAspectRatio="xMidYMin slice">
        <defs>
          <linearGradient id="db-vine-grad" x1="0" y1="1" x2="0.15" y2="0">
            <stop offset="0" stopColor="#5b8cff" />
            <stop offset="1" stopColor="#a974ff" />
          </linearGradient>
          {/* New growth. Deeper green at the base running to a yellow-green at the tip, the way
              a young leaf catches light — the same axis as the brand gradient above so the two
              kinds of leaf read as the same plant. */}
          <linearGradient id="db-vine-grad-green" x1="0" y1="1" x2="0.15" y2="0">
            <stop offset="0" stopColor="#22b573" />
            <stop offset="1" stopColor="#a3e635" />
          </linearGradient>
        </defs>
        <g className="db-vine-sway">
          <g className="db-vine-art">
            {VINES.map((v, i) => (
              <path
                key={`v${i}`}
                className="db-vine-stroke"
                d={v.d}
                pathLength={1}
                style={{ animationDelay: v.delay }}
              />
            ))}
            {LEAVES.map((l, i) => (
              <g key={`l${i}`} transform={`translate(${l.x},${l.y}) rotate(${l.r}) scale(${l.s})`}>
                <path className="db-leaf" d={LEAF} style={{ animationDelay: `${l.delay}s` }} />
              </g>
            ))}
            {/* The per-leaf keyframes. Generated on the server from the physics above, so they
                are as static as the rest of this SVG — no JS, no runtime cost beyond the CSS. */}
            <style dangerouslySetInnerHTML={{ __html: GROWTH_CSS }} />
            {/* Nested transforms on purpose. The OUTER <g> only moves the leaf into place, so the
                fall <g> — whose keyframes are a screen-space translate + tumble — drops downward
                regardless of which way the blade points; rotating before translating would send
                each leaf off along its own axis. The life <g> inside it owns the unfurl and the
                opacity, so the two animations never fight over one transform. */}
            {GROWTH.map((l, i) => (
              <g key={`n${i}`} transform={`translate(${l.x},${l.y})`}>
                <g
                  className="db-leaf-fall"
                  style={{
                    animationName: l.fall,
                    animationDuration: `${l.dur}s`,
                    animationDelay: `${l.delay}s`,
                  }}
                >
                  <g
                    className="db-leaf-life"
                    style={{
                      animationName: l.life,
                      animationDuration: `${l.dur}s`,
                      animationDelay: `${l.delay}s`,
                    }}
                  >
                    <g transform={`rotate(${l.r}) scale(${l.s})`}>
                      <path
                        className={`db-leaf-still${l.green ? " db-leaf-green" : ""}`}
                        d={LEAF}
                      />
                    </g>
                  </g>
                </g>
              </g>
            ))}
            {BUDS.map((b, i) => (
              <g key={`b${i}`}>
                <circle
                  className="db-vine-halo"
                  cx={b.x}
                  cy={b.y}
                  r={8}
                  style={{ animationDelay: `${b.delay}s` }}
                />
                <circle
                  className="db-vine-bud"
                  cx={b.x}
                  cy={b.y}
                  r={3.2}
                  style={{ animationDelay: `${b.delay}s` }}
                />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
