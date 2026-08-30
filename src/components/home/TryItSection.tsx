import { AskDemo, type DemoQuestion } from "./AskDemo";
import { DocsFrame } from "./DocsFrame";
import { DocsLoop } from "./DocsLoop";
import type { HomeDemo } from "@/lib/home-demo";

/**
 * The three questions the chips offer.
 *
 * Each `href` is where the assistant would cite anyway, so the fallback (no demo site) lands a
 * visitor on the page that actually answers rather than on a generic docs index. They're chosen
 * to be the three things a prospect evaluating a docs platform actually wants to know: can I
 * bring what I have, can I keep some of it private, and what does publishing do to my repo.
 */
function questionsFor(docsUrl: string): DemoQuestion[] {
  return [
    {
      q: "How do I migrate an existing docs.json site?",
      href: `${docsUrl}guides/migrate`,
    },
    {
      q: "Can I keep some pages private?",
      href: `${docsUrl}auth/reader-auth`,
    },
    {
      q: "Does the editor publish a commit or a pull request?",
      href: `${docsUrl}control-plane/editor`,
    },
  ];
}

/**
 * "Try it" — the product itself, running on the marketing page.
 *
 * One framed demo carries the whole story: a real rendered docs site you can search and browse,
 * and an Edit button that turns the same frame into the real visual editor. Underneath, three
 * chips put a question to the assistant. Nothing here is a mock — a mock would have to be kept
 * in step with the product forever, and would teach visitors something we can't promise is true.
 */
export function TryItSection({
  demo,
  docsUrl,
  frameUrl,
}: {
  demo: HomeDemo | null;
  docsUrl: string;
  frameUrl: string | null;
}) {
  return (
    // `overflow-hidden` is load-bearing, not tidiness: the phone treatment below deliberately
    // runs the demo card past the right edge of the screen, and without a clipping ancestor that
    // gives the whole PAGE a horizontal scrollbar.
    <section className="relative mt-4 overflow-hidden">
      {/* The band: a saturated field behind the frame so the demo reads as a lit screen rather
          than another block of page, and so the browser chrome has something to sit on.
          Pointer-events-none and behind everything — it's scenery, not a surface.

          The base tint is `rgba(var(--ink-rgb), α)`, the house overlay channel, so it lightens
          the dark appearance and darkens the light one from a single declaration. A literal dark
          overlay here (the obvious first cut) painted a grey haze across the light platform
          theme — the same trap that once rendered the editor chrome all-white. The blue/violet
          glows are brand accents and are translucent enough to read on both. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 55% at 50% 8%, rgba(91,140,255,0.30), transparent 72%)," +
            "radial-gradient(55% 45% at 84% 72%, rgba(169,116,255,0.22), transparent 70%)," +
            "radial-gradient(45% 40% at 12% 88%, rgba(91,140,255,0.14), transparent 70%)," +
            "linear-gradient(180deg, transparent, rgba(var(--ink-rgb),0.05) 16%," +
            "rgba(var(--ink-rgb),0.05) 86%, transparent)",
        }}
      />

      {/* The demo runs WIDER than the rest of the page — near-full-bleed with a gutter,
          rather than the prose column the sections below use. It earns it: the frame holds a
          real docs site (sidebar + content + TOC) in Read, and two panes side by side in
          Edit, and both were cramped at the old 1024px. The heading above it keeps its own
          narrow cap so the reading measure is unaffected. */}
      <div className="mx-auto max-w-[88rem] px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="db-ring mono inline-flex items-center rounded-full px-3 py-1 text-xs text-[var(--muted)]">
            Try it — no account needed
          </span>
          <h2 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
            Have a go, right here
          </h2>
          <p className="mt-4 text-[var(--muted)]">
            This is the real product on this page — a live docs site, and the same editor your
            team would write in.{" "}
            {/* The last sentence is only true where the interactive frame renders. On a phone
                the section shows a recording, so promising a switch would be a lie by layout. */}
            <span className="hidden md:inline">Switch between them.</span>
            <span className="md:hidden">Open it on a laptop to edit a page yourself.</span>
          </p>
        </div>

        {/* Two treatments, chosen by width rather than by device. The interactive frame needs
            room the phone hasn't got (see DocsLoop for why a phone-width iframe is worse than a
            recording), and `hidden` does the right thing on both sides: DocsFrame only loads the
            iframe once its IntersectionObserver fires, and a display:none element never
            intersects — so on a phone the third-party document is never fetched at all, and
            neither is the editor chunk behind it. */}
        <div className="mt-12 hidden md:block">
          <DocsFrame url={frameUrl} />
        </div>
        {/* Bleeds off the right edge (-mr-14 against the section's px-6 gutter, so 32px of the
            card sits off-screen). A docs site is wider than a phone; letting it run out of frame
            says so, where a card that stops politely at the gutter reads as a small screenshot.
            DocsLoop pads its chrome and footer rows to match, so nothing readable goes with it. */}
        <div className="-mr-14 mt-12 md:hidden">
          <DocsLoop url={frameUrl} />
        </div>

        <div className="mt-16">
          <h3 className="text-lg font-semibold">Ask the assistant</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            {demo
              ? "These answers come from Papervine's own documentation — through the same widget you add to your site with one script tag. Answers cite the page they came from."
              : "Our own documentation answers these — the same assistant your readers would get, citing the page each answer came from."}
          </p>
          <div className="mt-5">
            <AskDemo widgetId={demo?.widgetId ?? null} questions={questionsFor(docsUrl)} />
          </div>
        </div>
      </div>
    </section>
  );
}
