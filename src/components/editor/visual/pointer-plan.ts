// Pure planning for remote collaborators' MOUSE pointers in the Visual editor — the companion to
// caret-plan.ts, extracted for the same reason: this is arithmetic about other people's screens,
// and arithmetic deserves a test rather than two browsers and a squint.
//
// WHY NOT VIEWPORT COORDINATES. The obvious "send clientX/clientY" is wrong the moment two people
// have different window sizes, sidebars open, or scroll positions — a pointer at the top of my
// viewport is halfway down yours. A document editor has something better to hang coordinates on:
// the content column. Both clients render the same document with the same CSS, so
//
//   x → a FRACTION of the content column's width (0…1)
//   y → a distance in DOCUMENT space (from the top of the content, scroll included)
//
// travels correctly: the receiver multiplies the fraction by its own column width and subtracts
// its own scroll. Different window widths land in the same place *relative to the text*, which is
// what someone pointing at a paragraph actually means. It cannot survive a genuinely different
// layout (a wildly different zoom, a font that wraps differently) — no coordinate scheme can — and
// that's the accepted limit, the same "cosmetic" bargain SPEC §9.2 makes for carets.

/** What a peer publishes into awareness under `pointer`. */
export interface PointerState {
  /** Horizontal position as a fraction of the content column (0 = left edge, 1 = right edge). */
  xFrac: number;
  /** Vertical position in document space: distance from the top of the editor's content. */
  yDoc: number;
}

/** The geometry the receiver measures locally to place a peer's pointer. */
export interface PointerViewport {
  /** Content column's left edge and width, in client coordinates. */
  left: number;
  width: number;
  /** Content top edge in client coordinates, and how far the editor is scrolled. */
  top: number;
  scrollTop: number;
  /** Visible height, so a pointer scrolled out of view can be dropped rather than drawn off-panel. */
  height: number;
}

export interface RemotePointer {
  clientId: number;
  color: string;
  name: string;
  /** Where to draw it, in client coordinates. */
  x: number;
  y: number;
}

export const DEFAULT_POINTER_COLOR = "#8b5cf6";
export const DEFAULT_POINTER_NAME = "Editor";

/** A pointer this far above/below the visible area is dropped — it isn't in the room's view. */
const OFFSCREEN_SLACK = 40;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Turn an awareness snapshot into the pointers to draw, given our own geometry.
 *
 *  - skips our own client (we have a real mouse cursor already);
 *  - skips peers with no `pointer` (they aren't in the Visual editor, or their toggle is off, or
 *    their mouse has left the editor — all three publish `null`);
 *  - ignores nonsense (missing/NaN coordinates) rather than drawing at 0,0;
 *  - clamps the horizontal fraction into the column, so a pointer that was over a wider window's
 *    margin lands at this column's edge instead of outside it;
 *  - drops anything scrolled out of view, with a little slack so a pointer just off the edge still
 *    reads as "just above".
 */
export function planRemotePointers(
  states: Iterable<[number, Record<string, unknown>]>,
  selfClientId: number,
  viewport: PointerViewport,
): RemotePointer[] {
  const out: RemotePointer[] = [];
  if (!(viewport.width > 0)) return out;

  for (const [clientId, s] of states) {
    if (clientId === selfClientId) continue;
    const p = s.pointer as Partial<PointerState> | null | undefined;
    if (!p || !isFiniteNumber(p.xFrac) || !isFiniteNumber(p.yDoc)) continue;

    const user = (s.user as { name?: unknown; color?: unknown }) ?? {};
    const color = typeof user.color === "string" ? user.color : DEFAULT_POINTER_COLOR;
    const name = typeof user.name === "string" ? user.name : DEFAULT_POINTER_NAME;

    const frac = Math.max(0, Math.min(1, p.xFrac));
    const x = viewport.left + frac * viewport.width;
    const y = viewport.top + p.yDoc - viewport.scrollTop;

    if (y < viewport.top - OFFSCREEN_SLACK) continue;
    if (y > viewport.top + viewport.height + OFFSCREEN_SLACK) continue;

    out.push({ clientId, color, name, x, y });
  }
  return out;
}

/**
 * The inverse, for publishing our own pointer: a mouse event's client coordinates → the
 * layout-independent pair peers can place. Returns null when the pointer isn't over the content
 * column at all (the surrounding chrome), so we publish "no pointer" rather than a clamped lie.
 */
export function localPointerState(
  client: { x: number; y: number },
  viewport: PointerViewport,
): PointerState | null {
  if (!(viewport.width > 0)) return null;
  const xFrac = (client.x - viewport.left) / viewport.width;
  // A margin either side is still "pointing at the text"; well outside it is not.
  if (xFrac < -0.25 || xFrac > 1.25) return null;
  return {
    xFrac: Math.max(0, Math.min(1, xFrac)),
    yDoc: client.y - viewport.top + viewport.scrollTop,
  };
}
