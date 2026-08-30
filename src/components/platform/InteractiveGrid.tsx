/**
 * The auth pages' backdrop: the platform grid, with cells that light under the cursor.
 *
 * A CSS take on MagicUI's InteractiveGridPattern rather than that component itself. The upstream
 * holds the hovered cell in React state, which makes it a client component and re-renders every
 * one of these ~800 rects on each cell change — for a backdrop. `rect:hover` does the same job
 * in two CSS rules, so this stays a **server component** with no hydration and no work on the
 * main thread while someone is typing a password.
 *
 * The fast-in / slow-out timing is the upstream's too (its `not-[&:hover]:duration-1000`): the
 * cell lights immediately and fades over most of a second, so a moved cursor leaves a trail
 * rather than a hard on/off.
 *
 * Sized to overflow a large viewport and clipped by its wrapper — the alternative, stretching
 * the SVG to the viewport, would make the cells rectangles at every width but one.
 */

/** Matches `.db-grid`'s 56px rhythm, so the two backdrops are interchangeable. */
const CELL = 56;
const COLS = 36;
const ROWS = 22;

export function InteractiveGrid() {
  return (
    <div className="db-igrid" aria-hidden>
      <svg width={CELL * COLS} height={CELL * ROWS} focusable="false">
        {Array.from({ length: COLS * ROWS }, (_, i) => (
          <rect
            key={i}
            x={(i % COLS) * CELL}
            y={Math.floor(i / COLS) * CELL}
            width={CELL}
            height={CELL}
          />
        ))}
      </svg>
    </div>
  );
}
