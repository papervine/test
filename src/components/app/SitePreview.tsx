"use client";

import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatLoadTime } from "@/lib/load-time";

// Live preview — a real (scaled) iframe of the tenant's rendered home page, with a
// load-time read-out below it (kept off the thumbnail so it never covers the docs graphic).
// The iframe is cross-origin ({slug}.papervine.io ≠ app.), so we can't read its
// Navigation/Resource Timing; what we *can* measure is wall-clock from mount to the
// iframe's `load` event (fires regardless of origin). That's the viewer-side "time to load
// the preview" — it varies per viewer's network, hence the tooltip caveat.
export function SitePreview({ siteUrl, name }: { siteUrl: string; name: string }) {
  // performance.now() is a render-stable monotonic clock; set once on first render so the
  // start mark predates the browser actually fetching the iframe src.
  const startRef = useRef<number>(performance.now());
  const [ms, setMs] = useState<number | null>(null);

  const loaded = ms == null ? null : formatLoadTime(ms);

  return (
    <div>
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

        <span className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
          Open site <ExternalLink className="size-3" />
        </span>
      </a>

      {/* Load-time read-out, below the thumbnail. Reserve the row height (min-h) so the
          card doesn't reflow when the measurement lands. */}
      <div
        className="mt-2 flex min-h-5 items-center gap-1.5 text-xs text-[var(--muted)]"
        title="Time to load the preview in your browser"
      >
        {loaded && (
          <>
            <span className={`size-1.5 rounded-full ${loaded.dotClass}`} />
            Loaded in{" "}
            <span className={`tabular-nums ${loaded.textClass}`}>{loaded.label}</span>
          </>
        )}
      </div>
    </div>
  );
}
