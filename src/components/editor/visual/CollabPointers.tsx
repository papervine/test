"use client";

import { useEffect, useRef, useState } from "react";
import type { Awareness } from "y-protocols/awareness";
import {
  localPointerState,
  planRemotePointers,
  type PointerViewport,
  type RemotePointer,
} from "./pointer-plan";

/**
 * Remote collaborators' MOUSE pointers over the Visual editor — the "someone else is here, and
 * that's where they're looking" half of presence, next to the carets (CollabCarets) that show
 * where they're typing.
 *
 * Rides the same Yjs awareness as the carets, under its own `pointer` field, so it needs no
 * transport of its own and inherits the room's identity: each pointer is labelled and coloured
 * exactly like that person's caret (collab/presence.ts). Coordinates are layout-independent — see
 * pointer-plan.ts for why viewport coordinates are the wrong thing to send.
 *
 * Rendered as an overlay rather than as ProseMirror decorations, deliberately: a pointer is not
 * anchored to a document position, and pushing 20 mouse events a second through a decoration
 * rebuild would make every peer's editor re-render on every twitch of somebody else's hand.
 *
 * `enabled` is the user's toggle. Off means BOTH directions stop: we publish nothing (so nobody
 * watches our mouse either) and draw nothing. That symmetry is the point — a presence feature you
 * can't switch off is surveillance, and one that only hides other people's pointers while still
 * broadcasting yours is worse than either.
 */
export function CollabPointers({
  container,
  content,
  awareness,
  enabled,
}: {
  /** The editor's scroll container — the element pointers are measured and drawn against. */
  container: HTMLElement | null;
  /** The content column (`.ProseMirror`), whose width the horizontal fraction is relative to. */
  content: HTMLElement | null;
  awareness: Awareness | null;
  enabled: boolean;
}) {
  const [pointers, setPointers] = useState<RemotePointer[]>([]);
  // Publishing is throttled to one write per frame-ish: awareness is a CRDT broadcast to everyone
  // in the room, and a raw mousemove stream is 60+ writes a second per person.
  const lastSent = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);

  const measure = (): PointerViewport | null => {
    if (!container || !content) return null;
    const box = container.getBoundingClientRect();
    const col = content.getBoundingClientRect();
    // The content column's own padding is the drag-handle gutter, not text — measure the text.
    const style = getComputedStyle(content);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    return {
      left: col.left + padLeft,
      width: Math.max(0, col.width - padLeft - padRight),
      top: box.top,
      scrollTop: container.scrollTop,
      height: box.height,
    };
  };

  // Publish our own pointer.
  useEffect(() => {
    if (!enabled || !awareness || !container) return;
    let frame = 0;

    const flush = () => {
      frame = 0;
      const at = pending.current;
      pending.current = null;
      if (!at) return;
      const viewport = measure();
      if (!viewport) return;
      awareness.setLocalStateField("pointer", localPointerState(at, viewport));
      lastSent.current = Date.now();
    };

    const onMove = (e: MouseEvent) => {
      // Nobody else in the room → nothing to tell. Worth checking per move rather than publishing
      // into the void: every awareness write is a broadcast, and a solo editor moving its mouse
      // should cost exactly nothing.
      if (awareness.getStates().size < 2) return;
      pending.current = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    };
    // Leaving the editor clears it, so a parked pointer doesn't sit on someone else's screen
    // forever pointing at a paragraph nobody is looking at.
    const onLeave = () => {
      pending.current = null;
      awareness.setLocalStateField("pointer", null);
    };

    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", onLeave);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      awareness.setLocalStateField("pointer", null);
    };
  }, [enabled, awareness, container, content]);

  // Draw everyone else's. Recomputed on awareness change AND on scroll/resize, since both move a
  // document-space position on screen without anybody's mouse having moved.
  useEffect(() => {
    if (!enabled || !awareness || !container || !content) {
      setPointers([]);
      return;
    }
    let frame = 0;
    const recompute = () => {
      frame = 0;
      const viewport = measure();
      if (!viewport) return;
      setPointers(planRemotePointers(awareness.getStates(), awareness.clientID, viewport));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(recompute);
    };

    recompute();
    awareness.on("change", schedule);
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      awareness.off("change", schedule);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled, awareness, container, content]);

  if (!enabled || pointers.length === 0) return null;

  return (
    <div className="pv-pointer-layer" aria-hidden>
      {pointers.map((p) => (
        <div key={p.clientId} className="pv-pointer" style={{ left: p.x, top: p.y }}>
          {/* An arrow, drawn rather than an emoji or a border trick: it has to read as a cursor at
              any size and take the peer's colour as its fill. */}
          <svg viewBox="0 0 12 18" width="14" height="20" className="pv-pointer-arrow">
            <path d="M1 1l9.5 9.5-4.2.4 2.4 5-2 1-2.5-5.2L1 14.5z" fill={p.color} stroke="#0b0b0f" strokeWidth="0.8" />
          </svg>
          <span className="pv-pointer-name" style={{ backgroundColor: p.color }}>
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}
