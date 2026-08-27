"use client";

import { useState } from "react";
import Image from "next/image";
import { Play } from "lucide-react";
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
 * The hero's product shot: the poster frame of the tour, which plays in place when clicked.
 *
 * Click-to-play rather than an autoplaying background loop, for two reasons. The payload —
 * autoplay makes every visitor download the whole file before they've shown any interest,
 * which is exactly the kind of work-on-the-critical-path this project measures and removes
 * (SPEC §12). And the content: this is a narrated 1:45 tour with twelve scenes, not ambient
 * motion, so it wants to be started deliberately and seeked. The poster carries the argument
 * for anyone who never clicks — it shows a docs.json repo on the left and the rendered site
 * on the right.
 *
 * The film contains its own browser chrome in nearly every scene, so this frame deliberately
 * has none: a second set of traffic lights around it would read as a window inside a window.
 *
 * Colours inside the frame are LITERALS, not `.db` tokens, and must stay that way: the frame is
 * dark in both platform appearances (a dark film needs a dark bezel), so `var(--fg)` on the
 * label would resolve to #1b1b21 under `html[data-db-theme="light"]` and put near-black text on
 * a near-black scrim. Same reason the focus ring offset is #0a0a12.
 */
export function HeroVideo() {
  const [playing, setPlaying] = useState(false);

  return (
    <div
      className="db-rise relative rounded-2xl p-[1px]"
      style={{
        animationDelay: "380ms",
        background:
          "linear-gradient(160deg, rgba(140,140,255,0.5), rgba(255,255,255,0.04) 40%)",
      }}
    >
      <div className="relative aspect-video overflow-hidden rounded-2xl bg-[#0a0a12]">
        {playing ? (
          <video
            // eslint-disable-next-line jsx-a11y/media-has-caption -- music bed only, no
            // dialogue: every claim the tour makes is on-screen type (video/SCRIPT.md), so
            // there is no speech to caption. Revisit if a voiceover is ever added.
            src={TOUR_VIDEO}
            controls
            autoPlay
            playsInline
            preload="auto"
            className="h-full w-full"
          />
        ) : (
          <>
            <Image
              src={tourPoster}
              alt="A docs.json repository on the left, and the documentation site Papervine renders from it on the right."
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 1024px"
              className="object-cover"
            />
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`Play the Papervine product tour, ${RUNTIME} long`}
              className="group absolute inset-0 grid place-items-center bg-[rgba(6,6,9,0.32)] transition-colors hover:bg-[rgba(6,6,9,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a12]"
            >
              <span className="flex flex-col items-center gap-4">
                <span className="db-cta grid h-16 w-16 place-items-center rounded-full text-white transition-transform group-hover:scale-105 sm:h-20 sm:w-20">
                  <Play className="ml-0.5 h-6 w-6 sm:h-7 sm:w-7" fill="currentColor" />
                </span>
                <span className="mono text-xs text-[#ececf1] sm:text-sm">
                  Watch the tour · {RUNTIME}
                </span>
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
