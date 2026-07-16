// Pure caret-planning logic for the Visual editor's remote collaborator carets, extracted from
// CollabCarets so it can be unit-tested in plain Node (no ProseMirror / TipTap / DOM). Given the
// peers' awareness states, it decides WHERE each remote caret and selection band goes; CollabCarets
// maps the result onto ProseMirror Decorations. See CollabCarets.ts for the why (text-canonical
// model, Visual↔Visual scope).

export const DEFAULT_CARET_COLOR = "#8b5cf6";
export const DEFAULT_CARET_NAME = "Editor";

export interface RemoteCaret {
  /** The awareness clientID this caret belongs to (used as the decoration key so it reuses DOM). */
  clientId: number;
  color: string;
  name: string;
  /** Caret position, clamped into the document. */
  head: number;
  /** The highlighted range when the peer has a non-empty selection; null for a bare caret. */
  selection: { from: number; to: number } | null;
}

interface AwarenessCursor {
  anchor?: unknown;
  head?: unknown;
}

/**
 * Plan the remote carets to render, from a snapshot of awareness states. Pure and deterministic:
 *
 *  - skips our own client (`selfClientId`) — we don't draw our own remote caret;
 *  - skips peers with no `visualCursor` (they're present but not in the Visual editor, e.g. a
 *    Source-mode peer, whose cursor lives in a different coordinate space);
 *  - clamps positions into `[0, docSize]` so a stale position from a since-shrunk doc can't point
 *    off the end;
 *  - emits a selection band only when the selection is non-empty, and always a caret at `head`.
 */
export function planRemoteCarets(
  states: Iterable<[number, Record<string, unknown>]>,
  selfClientId: number,
  docSize: number,
): RemoteCaret[] {
  const clamp = (n: number) => Math.max(0, Math.min(n, docSize));
  const out: RemoteCaret[] = [];
  for (const [clientId, s] of states) {
    if (clientId === selfClientId) continue; // not our own
    const cur = s.visualCursor as AwarenessCursor | null | undefined;
    if (!cur || typeof cur.head !== "number") continue;
    const user = (s.user as { name?: unknown; color?: unknown }) ?? {};
    const color = typeof user.color === "string" ? user.color : DEFAULT_CARET_COLOR;
    const name = typeof user.name === "string" ? user.name : DEFAULT_CARET_NAME;
    const head = clamp(cur.head);
    const anchor = clamp(typeof cur.anchor === "number" ? cur.anchor : cur.head);
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    out.push({ clientId, color, name, head, selection: from !== to ? { from, to } : null });
  }
  return out;
}

/** `#rrggbb` → `rgba(r, g, b, a)`; returns the input unchanged if it isn't a 6-digit hex. */
export function rgba(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}
