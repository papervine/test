"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { PenLine, BookOpen, RotateCcw } from "lucide-react";

// TipTap is a large dependency graph and the home page is the SEO landing, so the editor stays
// a separate chunk that is only requested when someone actually clicks Edit — the same rule the
// hero video's click-to-play follows. `ssr: false` because the editor is browser-only.
const EditorDemo = dynamic(() => import("./EditorDemo").then((m) => m.EditorDemo), {
  ssr: false,
  loading: () => (
    <div className="grid h-[560px] lg:h-[660px] place-items-center">
      <span className="mono text-xs text-[var(--muted)]">Loading the editor…</span>
    </div>
  ),
});

type Mode = "read" | "edit";

/**
 * The home page's one live demo: a real docs site inside browser chrome, with an Edit button
 * that swaps the same frame over to the real visual editor.
 *
 * Both halves are the shipped product. Reading is an iframe of an actual Papervine-rendered
 * site — real nav, real ⌘K search, a real API console, its own assistant — not a screenshot.
 * Editing mounts the same `VisualEditor` the dashboard uses, over an in-memory MDX string with
 * no backend (see EditorDemo). The button between them is the product's story in one gesture:
 * this is your docs site, and you can edit it in the browser.
 *
 * The iframe is NOT rendered until the section scrolls into view. A third-party document is the
 * heaviest thing on this page, and loading it for visitors who never scroll past the hero would
 * undo the care taken to keep the landing light.
 */
export function DocsFrame({ url }: { url: string | null }) {
  const [mode, setMode] = useState<Mode>("read");
  const [visible, setVisible] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Sticky: true once Edit has been opened, so the editor survives a trip back to Read.
  const [everEdited, setEverEdited] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // Keep the HOST page still while someone browses inside the frame.
  //
  // The framed site is a Next app, and its client-side navigations end in scrollIntoView/focus on
  // their own content. Inside an iframe those scroll EVERY ancestor scroll container — this
  // window included — so clicking a link in the demo yanked the page by hundreds of pixels
  // (measured: 632 -> 945, then -> 390 on the next click).
  //
  // The fix is to take the page's scroll range away entirely while the reader is inside the
  // frame: `position: fixed` on the body, held at the current offset. With no scroll range there
  // is nothing for scrollIntoView to move, so nothing moves — no jump, and no wiggle from
  // correcting one afterwards.
  //
  // Four things that do NOT work, all tried and measured, because each looks like the answer:
  //  - `pointerdown` on the frame never fires: events inside a cross-origin iframe do not bubble
  //    to the parent document, so there is no synchronous signal that a link was clicked at all.
  //  - `overflow: hidden` on the root still permits PROGRAMMATIC scrolling — it only stops the
  //    user, which was never the problem here.
  //  - `overflow: clip` does not stop it either.
  //  - Undoing the scroll on the next `scroll` event does work, but paints one frame at the wrong
  //    offset: the visible wiggle.
  //
  // Focus entering the frame is the only cue available, and crucially it STAYS true for every
  // later click — which is what makes this hold for the second and third link, where a blur-only
  // approach silently stopped working.
  useEffect(() => {
    const body = document.body;
    let lockedAt: number | null = null;

    const frameFocused = () => {
      const el = box.current?.querySelector("iframe") ?? null;
      return !!el && document.activeElement === el;
    };

    const lock = () => {
      if (lockedAt !== null) return;
      const y = window.scrollY;
      // Removing the document's scroll range hides the scrollbar, which would shift everything
      // sideways; pad by exactly the width it occupied.
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      lockedAt = y;
      body.style.position = "fixed";
      body.style.top = `-${y}px`;
      body.style.left = "0";
      body.style.right = "0";
      if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    };
    const unlock = () => {
      if (lockedAt === null) return;
      const y = lockedAt;
      lockedAt = null;
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.paddingRight = "";
      // The page was visually parked at `y` the whole time; put the real scroll back so nothing
      // appears to move on release.
      window.scrollTo(0, y);
    };

    // A microtask rather than a timeout: activeElement has settled, and this still runs before
    // the navigation's scroll.
    const onBlur = () => queueMicrotask(() => frameFocused() && lock());
    // The pointer leaving the demo means they want the page back.
    const onPointerOver = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) unlock();
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", unlock);
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", unlock);
      document.removeEventListener("pointerover", onPointerOver);
      unlock();
    };
  }, []);

  // The address bar shows the site's real public URL, minus the scheme — the point of the chrome
  // is to say "this is a docs website", and a visible https:// adds nothing to that.
  const address = url ? url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "docs.yourcompany.com";

  return (
    <div
      ref={box}
      className="overflow-hidden rounded-2xl border border-[rgba(var(--ink-rgb),0.1)] bg-[var(--surface)] shadow-2xl shadow-black/20"
    >
      {/* Browser chrome. Traffic lights + address bar, then the mode switch on the right. */}
      <div className="flex items-center gap-3 border-b border-[rgba(var(--ink-rgb),0.08)] px-4 py-3">
        <div className="flex shrink-0 gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="mono hidden min-w-0 flex-1 truncate rounded-lg bg-[rgba(var(--ink-rgb),0.05)] px-3 py-1 text-center text-xs text-[var(--muted)] sm:block">
          {mode === "read" ? address : "quickstart.mdx — press / to insert a block"}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-[rgba(var(--ink-rgb),0.05)] p-1 sm:ml-0">
          <button
            type="button"
            onClick={() => setMode("read")}
            aria-pressed={mode === "read"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "read"
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Read
          </button>
          <button
            type="button"
            onClick={() => {
              setEverEdited(true);
              setMode("edit");
            }}
            aria-pressed={mode === "edit"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "edit"
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-sm"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <PenLine className="h-3.5 w-3.5" />
            Edit this page
          </button>
        </div>
      </div>

      {/* Both modes stay MOUNTED once opened, hidden with `hidden` rather than unmounted: the
          iframe would otherwise re-download the site on every toggle, and the editor would throw
          away whatever the visitor had just typed — which reads as the demo losing their work. */}
      <div className={mode === "read" ? undefined : "hidden"}>
        {visible && url ? (
          <iframe
            key={reloadKey}
            src={url}
            title="A documentation site rendered by Papervine"
            loading="lazy"
            className="h-[560px] w-full border-0 bg-white lg:h-[660px]"
            // The frame shows our own site, but it is still a separate document embedded in the
            // marketing page: keep it from navigating the top-level window or opening popups.
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        ) : (
          <div className="grid h-[560px] lg:h-[660px] place-items-center px-6 text-center">
            <span className="mono text-xs text-[var(--muted)]">
              {url ? "Loading a live docs site…" : "A live docs site appears here."}
            </span>
          </div>
        )}
      </div>

      <div className={mode === "edit" ? undefined : "hidden"}>
        {/* Mounted from the first time Edit is opened and kept thereafter, so switching back to
            Read and returning doesn't discard what the visitor typed. Keyed off its own flag,
            not the iframe's reload counter — reusing that one mounted the whole editor chunk
            when someone pressed Reset in Read mode, which is the opposite of loading on intent. */}
        {everEdited ? <EditorDemo /> : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[rgba(var(--ink-rgb),0.08)] px-4 py-2.5">
        <span className="text-xs text-[var(--muted)]">
          {mode === "read"
            ? // Deliberately not naming the API reference: which site gets framed depends on the
              // deployment (the starter example has an OpenAPI spec, our own docs don't), and
              // copy that promises a tab the framed site lacks is worse than copy that doesn't.
              "A real Papervine site — browse it, search it, ask its assistant."
            : "The real editor, running in your browser. Nothing is saved."}
        </span>
        {mode === "read" && url && visible ? (
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {/* "Reload", not "Reset": this one re-fetches the framed site, while the editor's
                Reset restores the document. One label for two behaviours reads as a bug. */}
            Reload
          </button>
        ) : null}
      </div>
    </div>
  );
}
