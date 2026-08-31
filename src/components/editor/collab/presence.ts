// Who a collaborator IS, for the editor's presence surfaces: the peer roster's avatars and the
// remote carets' labels (SPEC §9.2). Pure, so the "same person is always the same colour" promise
// is provable in a unit test rather than eyeballed across two browsers.
//
// Identity comes from the SIGNED-IN USER, not from the Yjs clientID. Deriving it from the clientID
// (the original approach) had two problems that only show up with real collaborators: a caret
// labelled "Marlin" tells you nothing about who is typing, and two people in the same room could
// land on the same name AND colour — at which point "see who else is editing" fails exactly when
// it matters. Keyed on the user id, two different people can't collide on a name, and their colour
// is stable across rooms, reloads and machines: the blue caret is the same teammate tomorrow.

export interface PresenceIdentity {
  name: string;
  color: string;
}

/**
 * The presence palette. Distinct hues at similar weight — a caret label has white text on it, and
 * the selection band is the same colour at 22% alpha (see `rgba` in visual/caret-plan.ts), so
 * anything too pale reads as no highlight at all. Twelve rather than the original eight purely to
 * make a same-colour pair less likely in a room; nothing depends on the count.
 */
export const PRESENCE_COLORS = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#d946ef", // fuchsia
  "#84cc16", // lime
  "#f97316", // orange
  "#06b6d4", // cyan
] as const;

/** Fallback names for a client with no signed-in identity to show (see `anonymousIdentity`). */
const ANONYMOUS_NAMES = [
  "Otter",
  "Falcon",
  "Bramble",
  "Cinder",
  "Willow",
  "Marlin",
  "Sable",
  "Wren",
] as const;

/**
 * FNV-1a, 32-bit. A hash rather than an index because the input is a user id (an opaque string),
 * and it must map to the same colour in every browser and every process — so no `Math.random`, no
 * insertion order, and nothing derived from the Yjs clientID, which is fresh per tab.
 */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 16777619, as shifts — `h * 16777619` overflows past 32 bits and loses precision.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

/** The colour for a stable seed (a user id) — deterministic, and the same everywhere. */
export function presenceColor(seed: string): string {
  return PRESENCE_COLORS[hash32(seed) % PRESENCE_COLORS.length];
}

/**
 * The signed-in collaborator's presence: their real display name, and a colour keyed on their user
 * id. `name` is whatever the account carries; an empty one falls back to a generic label rather
 * than an empty caret bubble.
 */
export function presenceIdentity(user: { id: string; name?: string | null }): PresenceIdentity {
  const name = user.name?.trim();
  return { name: name || "Editor", color: presenceColor(user.id) };
}

/**
 * Presence for a client with no user identity available — the same-browser BroadcastChannel
 * fallback, which wires up synchronously and never asks the server who you are (that path has no
 * cross-machine peers to label, and paying a round trip before the editor connects would cost the
 * whole room its first paint). Keyed on the Yjs clientID, so two tabs still look different.
 */
export function anonymousIdentity(clientId: number): PresenceIdentity {
  const i = Math.abs(clientId) % ANONYMOUS_NAMES.length;
  return { name: ANONYMOUS_NAMES[i], color: PRESENCE_COLORS[i] };
}
