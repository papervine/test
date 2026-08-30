// A falling leaf, as physics rather than as a fade.
//
// The landing page's vines drop leaves (VineField). The first version faded a leaf out while
// sliding it 54px down a fixed curve, which reads as "disappearing", not "falling". A leaf
// falls the way it does because it is light and flat: gravity pulls, air resistance grows with
// the square of speed and caps it at a slow terminal velocity, and the blade catches far more
// air broadside than edge-on — so it flutters, glides sideways, and tumbles, and never takes
// a straight line down.
//
// This is that model, integrated ONCE (at module load, in the server component) into a list
// of samples that become CSS keyframes. Nothing runs in the browser; the page still ships no
// JS for the backdrop, and `prefers-reduced-motion` still collapses it to rest. Every input is
// seeded, so the output is deterministic and SSR-stable.
//
// Units: the SVG viewBox's pixels and seconds. Coordinates are screen-space (y grows downward),
// and angles are measured from +x with positive clockwise — which is how `rotate()` reads them
// in that space, so a sample's rotation can be written into a transform unchanged.

export interface LeafFallInput {
  /** Anything stable per leaf — its index is fine. Selects the leaf's character. */
  seed: number;
  /** The blade's drawn rotation in degrees (`rotate(r)` on a blade that points up, -y). */
  blade: number;
  /** Where the leaf lets go (viewBox y), and the y below which it is out of frame. */
  startY: number;
  floorY: number;
}

/** One moment of the fall, relative to the release point. `rot` is in degrees. */
export interface LeafSample {
  t: number;
  x: number;
  y: number;
  rot: number;
}

/** Deterministic [0,1) from an integer seed and a channel — no Math.random, so SSR is stable. */
function rand(seed: number, channel: number): number {
  const x = Math.sin((seed + 1) * 12.9898 + (channel + 1) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const G = 520; // px/s² — gravity, sized to the viewBox rather than to metres
const DT = 1 / 240; // integration step: small, because the drag term is stiff at low speed
// Keyframes per second of fall; CSS interpolates linearly between them. 8 Hz is the budget call:
// at these speeds a leaf moves ~10px between samples, which nobody can tell from a curve, and
// nine leaves' worth of keyframes ride inline in the landing page's HTML (≈6KB gzipped at 8 Hz
// against ≈10KB at 12).
const SAMPLE_EVERY = 1 / 8;
const MAX_T = 16; // a leaf that hasn't left the frame by now is written off as landed

export function simulateLeafFall({ seed, blade, startY, floorY }: LeafFallInput): LeafSample[] {
  const r = (channel: number) => rand(seed, channel);

  // Terminal velocity broadside: slow, so a fall is something you watch rather than notice.
  // Drag along the blade's own axis is a fraction of that — edge-on, a leaf slips through air.
  const vTerminal = 68 + r(0) * 30;
  const kPerp = G / (vTerminal * vTerminal);
  const kPar = kPerp * 0.22;
  // Lift: a tilted blade is pushed sideways in proportion to how it meets the air.
  const cLift = 0.03 + r(1) * 0.03;
  // Rotation: a restoring torque toward broadside (the way a sheet of paper settles flat to
  // its fall) with inertia, so it overshoots and rocks; damping decides how long it rocks for.
  // Some leaves start with a real spin and tumble a turn or two before the rocking takes over.
  const kTorque = 0.0009 + r(2) * 0.0012;
  const cDamp = 1.1 + r(3) * 1.4;
  const tumbles = r(4) < 0.35;
  let omega = (r(5) - 0.5) * (tumbles ? 14 : 1.6);
  // Wind: a steady drift plus a slow gust, different for every leaf so no two fall in step.
  const wind0 = (r(6) - 0.5) * 44;
  const gust = 10 + r(7) * 18;
  const gustPeriod = 2.6 + r(8) * 2.8;
  const gustPhase = r(9) * Math.PI * 2;

  // The blade points up (-y) before its own rotation, so its axis in screen angles is -90° + r.
  const theta0 = ((blade - 90) * Math.PI) / 180;
  let theta = theta0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let t = 0;

  const samples: LeafSample[] = [{ t: 0, x: 0, y: 0, rot: 0 }];
  let nextSample = SAMPLE_EVERY;

  while (t < MAX_T && startY + y < floorY) {
    const windX = wind0 + gust * Math.sin((2 * Math.PI * t) / gustPeriod + gustPhase);
    const rx = vx - windX; // velocity relative to the air
    const ry = vy;
    const speed = Math.hypot(rx, ry);

    let ax = 0;
    let ay = G;
    let alpha = -cDamp * omega;

    if (speed > 1e-6) {
      const bx = Math.cos(theta); // blade axis
      const by = Math.sin(theta);
      const nx = -by; // blade normal
      const ny = bx;
      const vPar = rx * bx + ry * by;
      const vPerp = rx * nx + ry * ny;
      // Drag, split along the blade and across it.
      ax -= kPar * speed * vPar * bx + kPerp * speed * vPerp * nx;
      ay -= kPar * speed * vPar * by + kPerp * speed * vPerp * ny;
      // Lift, perpendicular to the airflow: `2·vPar·vPerp` is `speed²·sin(2α)` for the angle
      // of attack α, so a blade flat to the flow (vPar = 0) or slicing it (vPerp = 0) gets none.
      const lift = cLift * 2 * vPar * vPerp;
      ax += (lift * -ry) / speed;
      ay += (lift * rx) / speed;
      // Torque toward broadside. ψ is the blade's deviation from lying across the flow, folded
      // into (-π/2, π/2] because a blade has two identical faces.
      const flowAngle = Math.atan2(ry, rx);
      let psi = theta - (flowAngle + Math.PI / 2);
      psi = ((((psi + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
      alpha -= kTorque * speed * speed * Math.sin(2 * psi);
    }

    vx += ax * DT;
    vy += ay * DT;
    omega += alpha * DT;
    x += vx * DT;
    y += vy * DT;
    theta += omega * DT;
    t += DT;

    if (t >= nextSample) {
      samples.push({ t, x, y, rot: ((theta - theta0) * 180) / Math.PI });
      nextSample += SAMPLE_EVERY;
    }
  }
  // The frame the fall ends on, so the keyframes close exactly where the physics did.
  const last = samples[samples.length - 1];
  if (last.t < t) samples.push({ t, x, y, rot: ((theta - theta0) * 180) / Math.PI });
  return samples;
}

/**
 * Where in a leaf's life cycle (percent of its animation) the fall starts and ends.
 *
 * The fall has to fit inside the cycle with the unfurl before it and a bare-stalk pause after
 * it; a leaf near the top of a tall vine takes far longer to reach the ground than one near the
 * bottom, so the release point moves earlier for the long fallers rather than every leaf sharing
 * one. Clamped so a leaf never lets go before it has properly grown in.
 */
export function fallWindow(fallSeconds: number, cycleSeconds: number): { release: number; end: number } {
  const span = (fallSeconds / cycleSeconds) * 100;
  const release = Math.max(30, Math.min(68, 100 - span - 4));
  return { release, end: Math.min(99, release + span) };
}

/** One decimal is a tenth of a viewBox pixel — below anything a screen can show, and a third off the size. */
const fmt = (n: number) => (Math.abs(n) < 0.05 ? "0" : n.toFixed(1).replace(/\.0$/, ""));

/**
 * The fall as CSS: motionless until `release`, then the sampled trajectory stretched over
 * `release..end`, then held out of frame until the cycle restarts.
 */
export function fallKeyframes(
  name: string,
  samples: LeafSample[],
  window: { release: number; end: number },
): string {
  const fallSeconds = samples[samples.length - 1].t || 1;
  const stops = samples.map((s) => {
    const pct = window.release + (s.t / fallSeconds) * (window.end - window.release);
    return `${fmt(pct)}%{transform:translate(${fmt(s.x)}px,${fmt(s.y)}px) rotate(${fmt(s.rot)}deg)}`;
  });
  const last = samples[samples.length - 1];
  const rest = `100%{transform:translate(${fmt(last.x)}px,${fmt(last.y)}px) rotate(${fmt(last.rot)}deg)}`;
  return `@keyframes ${name}{0%,${fmt(window.release)}%{transform:none}${stops.slice(1).join("")}${rest}}`;
}

/**
 * The life around the fall: unfurl quickly, hold, stay fully visible for the whole fall, and
 * only go dark once out of frame — the opacity cut is bookkeeping for the restart, not a fade
 * anyone sees.
 */
export function lifeKeyframes(name: string, window: { release: number; end: number }): string {
  const gone = fmt(Math.min(99.5, window.end + 0.4));
  return (
    `@keyframes ${name}{0%{opacity:0;transform:scale(.2)}6%{opacity:1;transform:scale(1)}` +
    `${fmt(window.end)}%{opacity:1;transform:scale(1)}${gone}%,100%{opacity:0;transform:scale(1)}}`
  );
}
