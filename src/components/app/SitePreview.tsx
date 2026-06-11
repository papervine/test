"use client";

import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

// Live preview — a real (scaled) iframe of the tenant's rendered home page, with a
// load-time badge. The iframe is cross-origin ({slug}.papervine.io ≠ app.), so we can't
// read its Navigation/Resource Timing; what we *can* measure is wall-clock from mount to
// the iframe's `load` event (fires regardless of origin). That's the viewer-side "time to
// load the preview" — it varies per viewer's network, hence the tooltip caveat.
export function SitePreview({ siteUrl, name }: { siteUrl: string; name: string }) {
  // performance.now() is a render-stable monotonic clock; set once on first render so the
  // start mark predates the browser actually fetching the iframe src.
  const startRef = useRef<number>(performance.now());
  const [ms, setMs] = useState<number | null>(null);

  const seconds = ms == null ? null : ms / 1000;
  // Green = snappy, amber = sluggish, red = slow. Mirrors the status pill palette.
  const tone =
    seconds == null
      ? ""
      : seconds < 1
        ? "bg-emerald-500/15 text-emerald-400"
        : seconds < 3
          ? "bg-amber-500/15 text-amber-400"
          : "bg-red-500/15 text-red-400";

  return (
    <a
      href={siteUrl}
      target="_blank"
      rel="noreferrer"
      className="db-ring group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]"
    >
      <iframe
        src={siteUrl}
        title={`${name} preview`}
        tabIndex={-1}
        aria-hidden
        onLoad={() => setMs(performance.now() - startRef.current)}
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: "200%", height: "200%", transform: "scale(0.5)" }}
      />

      {seconds != null && (
        <span
          title="Time to load the preview in your browser"
          className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs tabular-nums ${tone}`}
        >
          {seconds < 1 ? `${Math.round(ms!)}ms` : `${seconds.toFixed(1)}s`}
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
        Open site <ExternalLink className="size-3" />
      </span>
    </a>
  );
}
