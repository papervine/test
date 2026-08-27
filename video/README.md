# Papervine product tour video

A 1:45 SaaS product tour for papervine.io, built with [Remotion](https://remotion.dev) —
React components rendered to video, frame by frame.

**[`SCRIPT.md`](./SCRIPT.md) is the source of truth for the content**: the narration, the
shot-by-shot reasoning, and the timing table. Read it before changing a scene, and update it
when you do.

## Setup

```bash
npm i
# public/ is gitignored (it would duplicate a 900KB logo already in the repo), so seed it —
# the Brand and Close scenes load this through staticFile().
mkdir -p public && cp ../src/assets/papervine-logo.png public/papervine-logo.png
```

Rendering fails with a missing-asset error until that copy exists.

## Commands

```bash
npm i                                  # once
npm run dev                            # Remotion Studio — scrub, retime, edit props live
npx remotion render PapervineTour out/papervine-tour.mp4
npx remotion still <SceneId> --frame=120 --scale=0.5 out/check.png   # quick visual check
npx tsc --noEmit                       # this project's own typecheck
```

The Studio sidebar has `PapervineTour` (the deliverable) plus every scene registered
individually under **Scenes**, so you can work on one 8-second beat without scrubbing the
whole timeline. Double-clicking a sequence in the tour timeline jumps to that scene.

## Layout

```
src/
  PapervineVideo.tsx   the TransitionSeries that assembles the twelve scenes
  Root.tsx             composition registrations
  fonts.ts             Space Grotesk / Geist / Geist Mono, loaded once
  scenes/              one file per scene, in tour order
  components/          shared chrome — Backdrop, Stage, BrowserFrame, CodePanel, DocsSidebar
  lib/typing.ts        frame-driven typewriter
public/                gitignored — papervine-logo.png (copied, see Setup), voiceover.mp3 if added
```

`out/` is gitignored — renders and check stills never get committed.

## How it's built, and why

**The product UI is rebuilt in React, not screen-recorded.** It stays crisp at any resolution,
every beat can be timed to the frame, and rendering needs no dev server, seeded database, or
docker stack. The cost is that the mockups drift from the real UI — when a surface changes
materially, the scene needs updating, which is why each scene's header comment states what
claim it is making.

Every colour is a real product token from `src/styles/platform.css` (`--bg #060609`,
`--fg #ececf1`, `--muted #8a8a99`, `--blue #5b8cff`, `--violet #a974ff`) written as an inline
literal, and the fonts are the real stack.

**The `Stage` component is load-bearing.** Every product shot lives in the same 1728×748 box
inset from the top-left, which is what makes twelve cuts feel like one continuous product
instead of twelve slides — and it keeps the lower band clear for `SceneCaption`.

**`SceneCaption` is a label, not a headline.** One quiet line at body scale in a muted tone,
naming what the shot shows. An earlier version stacked a 46px marketing line over a mono list
of feature words there; it competed with the product for attention and read as an ad. Keep it
to one factual line — the UI is the argument, and the label only orients a muted viewer.

## Conventions (Remotion-specific, learned here)

- Animate with `useCurrentFrame()` + `interpolate()`, written **inline in the `style` prop**.
  CSS `transition`/`animation` and Tailwind animation classes do not render.
- Use the `scale` / `translate` / `rotate` CSS properties, not `transform` — only those stay
  editable in the Studio.
- **`interpolate()` accepts at most three whitespace-separated components in a string output
  range.** `"0px 0px"` interpolates; `circle(0px at 1649px 42px)` and `inset(0% 100% 0% 0%)`
  throw `String outputRange values must contain 1 to 3 components`. Interpolate the number and
  assemble the string in a template literal — see the appearance-toggle reveal in `Site.tsx`
  and the wordmark wipe in `Brand.tsx`.
- **A non-numeric string like `blur(7px)` cannot be interpolated at all** (`Non-numeric strings
  can only be interpolated using Easing.step1`). Same fix — see `Search.tsx`.
- A horizontal two-pane track (`Assistant.tsx`) needs its own `overflow: hidden` wrapper;
  `Stage` does not clip, so the off-stage pane bleeds into the frame without it.
- Text that types itself must **finish before its scene ends**. `typed()` takes frames-per-char
  and accepts fractions; when a beat is running long, shorten the copy rather than speeding the
  typing past legibility.

## Publishing the tour (marketing hero)

The homepage hero (`src/components/HeroVideo.tsx`) shows the tour's poster frame and plays the
film in place when clicked. Two artefacts feed it, and they are produced differently on purpose:

| Artefact | Lives in | Why |
|---|---|---|
| `papervine-tour.mp4` | public R2 bucket | 9.5MB with the music bed — ten times the largest file in git, and re-rendered whenever the product UI moves. R2 egress is free. |
| `audio/driftline-groove.mp3` | **not in the repo** (gitignored) | 3.7MB music bed. A build *input*, so it does not belong in `out/` either — put your copy at `video/audio/driftline-groove.mp3` before running the mux. Ask the design owner for the file; it is not reproducible from this repo. |
| `tour-poster.jpg` | `src/assets/` (committed) | 114KB, and it is the hero's LCP element — a static import gets it optimised to AVIF/WebP by `next/image` and served from `/_next/`, which the apex asset-rewrite middleware already excludes. |

None of the three are committed except the poster — which has to be, because
`HeroVideo.tsx` imports it and the build fails without it.

After re-rendering, rebuild them from `out/papervine-tour.mp4`:

```bash
# 1. Silent web master: drop Remotion's audio track and enable progressive playback.
# Remotion writes a SILENT AAC track at ~317kbps — about 4MB of the 11MB file encoding
# nothing — so dropping it is lossless and takes the file to 7.3MB.
mkdir -p out/web
ffmpeg -i out/papervine-tour.mp4 -c:v copy -an -movflags +faststart out/web/papervine-tour-silent.mp4

# 2. Mux the music bed. The picture is exactly 105.6s (3168 frames / 30fps) and the track is
# longer, so -shortest truncates the MUSIC at the last frame. Watch two things here: the mp3
# carries embedded cover art as an mjpeg stream, so streams are mapped explicitly or ffmpeg
# picks it up as a second video track; and -shortest would cut the PICTURE instead if you ever
# swap in a track shorter than 105.6s — that case needs `-af apad` or `-stream_loop -1`.
# The fade-out is not decoration: truncating a song mid-phrase hard-cuts on the last frame.
ffmpeg -i out/web/papervine-tour-silent.mp4 -i audio/driftline-groove.mp3 \
  -map 0:v:0 -map 1:a:0 -c:v copy \
  -c:a aac -b:a 160k -ar 48000 -ac 2 \
  -af "afade=t=out:st=103.6:d=2" \
  -shortest -movflags +faststart out/web/papervine-tour.mp4

# Poster: frame 560 — the Connect scene fully resolved, which shows the docs.json repo and
# the rendered site together. Update HeroVideo's alt text if you pick a different frame.
ffmpeg -i out/web/papervine-tour.mp4 -vf "select='eq(n\,560)'" -vsync 0 -frames:v 1 -q:v 2 out/web/tour-poster.jpg
cp out/web/tour-poster.jpg ../src/assets/tour-poster.jpg
```

The video stream is left untouched (`-c:v copy`). Remotion's output is already ~579kbps for
1080p, and this is text-heavy screen content where a second lossy pass costs legibility for a
saving R2's free egress makes pointless. A VP9/AV1 alternate was considered and skipped for the
same reason: it would halve the bytes but double the assets to keep in sync, and the file is
only fetched when a visitor clicks Play.

Then upload to the public bucket and make sure `TOUR_VIDEO` in `HeroVideo.tsx` matches:

```bash
# rclone remote pointing at the public R2 bucket, or `wrangler r2 object put`.
rclone copy out/web/papervine-tour.mp4 r2-public:<bucket>/ \
  --header-upload "Cache-Control: public, max-age=31536000, immutable"
```

Currently served from the bucket's **r2.dev development URL**, which Cloudflare rate-limits and
documents as unsuitable for production traffic — put the bucket behind a custom domain before
this hero takes real load, then swap the origin in `TOUR_VIDEO`.

Set `Cache-Control` on the object when you upload: the current one has none, so nothing tells
the edge or the browser it is immutable.

Give a re-cut a **new filename** (`papervine-tour-2.mp4`) rather than overwriting, so the
immutable cache header stays honest.

## Adding a voiceover

Drop the recording at `public/voiceover.mp3` and uncomment the `<Audio>` line in
`PapervineVideo.tsx`. `@remotion/media` is already installed. The scene start frames in
SCRIPT.md's timing table are the alignment marks; the narration paces to ~105s at 150 wpm
against a 105.6s picture.
