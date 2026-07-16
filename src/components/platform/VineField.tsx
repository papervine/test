// The landing page's ambient backdrop — a living counterpart to the static `.db-grid`
// the other "full" surfaces use. Three vines slowly *draw* themselves upward (an animated
// `stroke-dashoffset`), leaves unfurl in sequence as each vine climbs past them, and a
// glowing bud lights at every growing tip — then the whole thing settles into a barely
// perceptible sway. Pure SVG + CSS (see `.db-vine*` in platform.css), so it stays a server
// component: no JS ships, and `prefers-reduced-motion` collapses it to the grown-in state.
//
// "Papervine" — a vine sprouting from a page. The motion draws the eye up toward the headline.

// Each strand: its path and the delay before it begins drawing (a staggered sprout).
const VINES = [
  { d: "M600,772 C566,648 648,576 604,452 C566,344 648,300 600,176 C582,108 600,84 600,40", delay: "0s" },
  { d: "M372,772 C356,654 300,604 344,500 C384,404 300,360 360,256 C396,196 358,150 414,96", delay: ".5s" },
  { d: "M828,772 C844,654 900,604 856,500 C816,404 900,360 840,256 C804,196 842,150 786,96", delay: ".5s" },
];

// Leaves sit on the vine curves; each unfurls just as the stroke reaches it (hence the delay,
// tuned to the draw timing). x/y is the leaf base, r its orientation, s a size variation.
const LEAVES = [
  // center
  { x: 604, y: 452, r: 55, s: 1.05, delay: 2.2 },
  { x: 600, y: 360, r: -50, s: 1, delay: 3.1 },
  { x: 600, y: 230, r: 48, s: 1.1, delay: 4.2 },
  { x: 600, y: 150, r: -42, s: 0.9, delay: 5 },
  // left
  { x: 344, y: 500, r: -60, s: 1, delay: 1.9 },
  { x: 352, y: 404, r: 40, s: 1.05, delay: 2.8 },
  { x: 372, y: 300, r: -46, s: 1.1, delay: 3.9 },
  { x: 392, y: 200, r: 52, s: 0.9, delay: 4.8 },
  // right
  { x: 856, y: 500, r: 60, s: 1, delay: 1.9 },
  { x: 848, y: 404, r: -40, s: 1.05, delay: 2.8 },
  { x: 828, y: 300, r: 46, s: 1.1, delay: 3.9 },
  { x: 808, y: 200, r: -52, s: 0.9, delay: 4.8 },
];

// A glowing bud at each growing tip, lit once the strand finishes drawing.
const BUDS = [
  { x: 600, y: 40, delay: 5.6 },
  { x: 414, y: 96, delay: 5.4 },
  { x: 786, y: 96, delay: 5.4 },
];

// A single leaf blade, base at the local origin so it unfurls (scales) from where it joins.
const LEAF = "M0,0 C9,-4 16,-14 8,-28 C5,-18 -6,-11 0,0 Z";

export function VineField() {
  return (
    <div className="db-vine" aria-hidden="true">
      <svg viewBox="0 0 1200 760" preserveAspectRatio="xMidYMin slice">
        <defs>
          <linearGradient id="db-vine-grad" x1="0" y1="1" x2="0.15" y2="0">
            <stop offset="0" stopColor="#5b8cff" />
            <stop offset="1" stopColor="#a974ff" />
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
