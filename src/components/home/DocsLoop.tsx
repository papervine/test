"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

/** Where the clip was recorded — see `scripts/record-docs-loop.mjs`. */
const RECORDED_HOST = "docs.papervine.io";

// Served from the public R2 media bucket, alongside the product tour and for the same reasons
// (video/README.md): the file is re-recorded whenever the docs chrome moves, so committing it
// would add a fresh binary to git history every time, and R2 egress is free. Objects are
// uploaded immutable, so a re-record gets a NEW filename rather than overwriting these.
//
// NOTE: `pub-*.r2.dev` is Cloudflare's DEVELOPMENT URL for a public bucket — rate-limited, and
// documented as unsuitable for production traffic. Same caveat, and same one-line fix, as
// TOUR_VIDEO in HeroVideo.tsx: put the bucket behind a custom domain and swap the origin.
const MEDIA = "https://pub-c655146bc458440aa8c0969e063c9a4c.r2.dev";
const CLIP = `${MEDIA}/browse.mp4`;
const POSTER = `${MEDIA}/browse.png`;

// The clip is a 1280×800 desktop recording. Showing it at a phone's full width would put the
// text at 27% and make it a grey smear, so it's displayed at a fixed 680px — about half size —
// and CROPPED by the frame. What survives is the shape of a docs site (sidebar, tabs, content)
// plus the motion, which is the whole job. 680 × 800/1280 = 425.
const CLIP_HEIGHT = 425;

/**
 * What the "Try it" section shows on a phone, in place of the live iframe.
 *
 * The interactive demo is desktop-only for two reasons that don't go away by trying harder: a
 * desktop docs layout at 340px is unreadable, and the renderer's own mobile chrome has no
 * sidebar and no search button (both are `md:`-gated), so a phone-width iframe would show a
 * page you can only scroll — the least convincing possible version of "this is a real docs
 * site". A short silent loop of the same site being browsed says more in three seconds.
 *
 * It's a screen recording of the live site rather than an animated mock: it can't drift from
 * what we ship, and it's one command to re-record.
 */
export function DocsLoop({ url }: { url: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  // Undecided until the effect runs, so the first paint never guesses wrong about autoplay.
  const [autoplay, setAutoplay] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);

  // Not fetched until the section is close: a video the visitor never scrolls to is exactly the
  // weight the rest of this page works to avoid (SPEC §12).
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  // A looping video is motion nobody asked for; honour the OS setting and hand those visitors a
  // play button over the poster instead.
  useEffect(() => {
    setAutoplay(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  return (
    <div
      ref={box}
      className="overflow-hidden rounded-2xl border border-[rgba(var(--ink-rgb),0.1)] bg-[var(--surface)] shadow-2xl shadow-black/20"
    >
      <div className="flex items-center gap-3 border-b border-[rgba(var(--ink-rgb),0.08)] px-4 py-3">
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mono min-w-0 flex-1 truncate rounded-lg bg-[rgba(var(--ink-rgb),0.05)] px-3 py-1 text-center text-xs text-[var(--muted)]">
          {RECORDED_HOST}
        </div>
      </div>

      {/* The clip is recorded in the docs site's dark appearance, so the plate behind it — what
          shows for the moment before the poster paints — is dark too. */}
      <div className="relative overflow-hidden bg-[#0b0b0f]" style={{ height: CLIP_HEIGHT }}>
        {/* `max-w-none` matters: the global `img, video { max-width: 100% }` reset would shrink
            the clip back to the frame's width and undo the crop this whole component is built
            around. Height drives the size; width follows the 16:10 intrinsic ratio. */}
        <video
          ref={video}
          src={near ? CLIP : undefined}
          poster={near ? POSTER : undefined}
          muted
          loop
          playsInline
          preload="none"
          autoPlay={autoplay === true}
          onPlay={() => setPlaying(true)}
          aria-label="A recording of someone searching and browsing a Papervine documentation site"
          className="h-full w-auto max-w-none"
        />

        {/* The crop is deliberate, so say so: the page continues past the right edge. Fading to
            black rather than to the frame colour, because the clip under it is dark. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12"
          style={{ background: "linear-gradient(to right, transparent, rgba(0,0,0,0.45))" }}
        />

        {autoplay === false && !playing ? (
          <button
            type="button"
            onClick={() => void video.current?.play()}
            className="absolute inset-0 grid place-items-center bg-black/25"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-[#0a0a12]">
              <Play className="ml-0.5 h-5 w-5" fill="currentColor" />
            </span>
            <span className="sr-only">Play the recording</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[rgba(var(--ink-rgb),0.08)] px-4 py-2.5">
        <span className="text-xs text-[var(--muted)]">A real Papervine site, being browsed.</span>
        {url ? (
          <a
            href={url}
            className="shrink-0 text-xs font-medium text-[var(--fg)] underline decoration-dotted underline-offset-4"
          >
            Open it
          </a>
        ) : null}
      </div>
    </div>
  );
}
