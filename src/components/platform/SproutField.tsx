// A whisper-faint, full-viewport field of tiny seedlings that slowly grow, hold, wither,
// and regrow — the ambient companion to the headline-framing vines (VineField). Where the
// vines are the focal gesture, this is barely-there texture: a living replacement for the
// flat grid, scattered across the whole background and keyed off the `--ink-rgb` channel
// (like `.db-grid`) so it stays subtle and theme-adaptive. Pure CSS animation, no JS.
//
// Positions are a jittered grid (even coverage, no clumping) seeded deterministically — no
// Math.random, so SSR is stable. Each sprout varies in size, tilt, opacity, and speed, and
// starts at a negative delay so the field is mid-life on first paint rather than all popping
// in together. `prefers-reduced-motion` (in platform.css) freezes it grown-in at rest.

// Deterministic [0,1) hash — keeps the scatter stable across renders without Math.random.
function rand(i: number, seed: number) {
  const x = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const COLS = 8;
const ROWS = 6;
const SPROUTS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  // Cell center + up to ±40% jitter, so coverage is even but never gridded-looking.
  const left = ((col + 0.5) / COLS) * 100 + (rand(i, 1) - 0.5) * (80 / COLS);
  const top = ((row + 0.5) / ROWS) * 100 + (rand(i, 2) - 0.5) * (80 / ROWS);
  return {
    left,
    top,
    s: 0.5 + rand(i, 3) * 0.85, // size
    r: (rand(i, 4) - 0.5) * 26, // tilt, deg
    o: 0.05 + rand(i, 5) * 0.07, // peak opacity — kept very low
    dur: 16 + rand(i, 6) * 14, // grow→wither cycle, s
    delay: -(rand(i, 7) * 30), // negative: begin mid-cycle, desynced
  };
});

export function SproutField() {
  return (
    <div className="pv-sprouts" aria-hidden="true">
      {SPROUTS.map((p, i) => (
        <span
          key={i}
          className="pv-sprout"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              "--s": p.s,
              "--r": `${p.r}deg`,
              "--o": p.o,
              "--dur": `${p.dur}s`,
              "--delay": `${p.delay}s`,
            } as React.CSSProperties
          }
        >
          <svg viewBox="0 0 16 22">
            <path className="pv-sprout-stem" d="M8,22 C7.6,16 8.4,12 8,6" />
            <path className="pv-sprout-leaf" d="M8,13 C5,12 3,9 3.5,6 C6,7 7.6,9.5 8,13 Z" />
            <path className="pv-sprout-leaf" d="M8,10 C11,9 13,6 12.5,3 C10,4 8.4,6.5 8,10 Z" />
          </svg>
        </span>
      ))}
    </div>
  );
}
