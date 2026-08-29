"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Play, X } from "lucide-react";
import tourPoster from "@/assets/tour-poster.jpg";

// The tour lives in the public R2 bucket, not in this repo: it's 9.5MB — ten times the largest
// file in git — and it gets re-rendered whenever the product UI moves, so committing it would
// add a fresh multi-megabyte blob to history every iteration. R2 egress is free, so there's no
// bandwidth argument for degrading it further either. Build + upload steps: `video/README.md`.
//
// NOTE: `pub-*.r2.dev` is Cloudflare's DEVELOPMENT URL for a public bucket — it is rate-limited
// and Cloudflare documents it as not for production traffic. Fine while this is being reviewed;
// before this hero carries real traffic, put the bucket behind a custom domain and swap the
// origin here. The path stays `/papervine-tour.mp4`, so it's a one-line change.
const TOUR_VIDEO =
  "https://pub-c655146bc458440aa8c0969e063c9a4c.r2.dev/papervine-tour.mp4";

const RUNTIME = "1:45";

/**
 * The tour, as a small pill in the hero that opens the film in a modal.
 *
 * It used to be the hero's centrepiece — a full-width poster frame that played in place. The
 * live demo now holds that slot, because a visitor who can *use* the product is worth more than
 * one watching a video of it, and two large frames stacked above each other made the page read
 * as a showreel. The film is still here for people who want the guided version; it just no
 * longer outranks the thing it's describing.
 *
 * Click-to-play survives the move, and matters more than before (SPEC §12): the 9.5MB file is
 * only requested once someone opens the modal, so the hero costs a ~114KB static-import poster
 * thumbnail and nothing else. The poster still carries the argument for anyone who never clicks.
 */
export function HeroVideo() {
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Escape closes, and the page behind must not scroll while the film is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Play the Papervine product tour, ${RUNTIME} long`}
        className="db-feature group flex items-center gap-3 rounded-2xl p-2 pr-4 text-left transition-colors"
      >
        <span className="relative block h-11 w-20 shrink-0 overflow-hidden rounded-xl bg-[#0a0a12]">
          <Image
            src={tourPoster}
            alt=""
            aria-hidden
            fill
            sizes="80px"
            className="object-cover opacity-80 transition-opacity group-hover:opacity-100"
          />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-[#0a0a12]">
              <Play className="ml-0.5 h-3 w-3" fill="currentColor" />
            </span>
          </span>
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-medium">Watch the tour</span>
          <span className="mono text-xs text-[var(--muted)]">{RUNTIME}</span>
        </span>
      </button>

      {/* PORTALLED TO <body>, and it has to be. `position: fixed` resolves against the nearest
          ancestor with a transform/filter rather than the viewport, and this button sits inside
          the hero's `db-rise` entrance animation — so an in-place overlay rendered at the size
          and position of the little pill instead of filling the screen. The portal escapes every
          such ancestor; `db-portal` re-applies the platform palette outside the `.db` shell,
          which is the house rule for anything portalled to body (dialogs, dropdowns, toasts). */}
      {open
        ? createPortal(
            <div
              className="db-portal fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
              role="dialog"
              aria-modal="true"
              aria-label="Papervine product tour"
              // Click the backdrop to dismiss; clicks inside the player must not bubble out.
              onClick={() => setOpen(false)}
            >
              <div
                className="relative w-full max-w-6xl"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  ref={closeButton}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close the tour"
                  className="absolute -top-9 right-0 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-white/80 transition-colors hover:text-white"
                >
                  <X className="h-4 w-4" />
                  Close
                </button>
                <video
                  // eslint-disable-next-line jsx-a11y/media-has-caption -- music bed only, no
                  // dialogue: every claim the tour makes is on-screen type (video/SCRIPT.md),
                  // so there is no speech to caption. Revisit if a voiceover is ever added.
                  src={TOUR_VIDEO}
                  controls
                  autoPlay
                  playsInline
                  preload="auto"
                  className="aspect-video max-h-[82vh] w-full rounded-2xl bg-[#0a0a12]"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
