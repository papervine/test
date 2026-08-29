import {
  Pencil,
  Heading1,
  Heading2,
  Type,
  SquareStack,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

/**
 * The hero, appearing to be authored in the editor: for each block a caret types a `/` command,
 * the slash menu opens, an item is picked — and that block lands.
 *
 * A **server component**, like SparklesText and the vine. Every beat is an animation-delay off one
 * shared clock, so the whole choreography ships no JS on the page this repo works hardest to keep
 * light. The hero's real copy is server-rendered and merely *revealed* by `.pv-insert`; nothing
 * here builds markup, which is what keeps the headline crawlable and the smoke gate's raw-HTML
 * assertions true.
 *
 * The menu is a faithful copy of the real one — same `pv-slash-*` classes, and every title,
 * description and icon taken verbatim from `visual/menu-items.ts`. Anyone who has used the product
 * would spot an invented label instantly, and if the editor restyles this follows for free. (The
 * real menu is a hard-coded dark surface because it portals outside `.db`, which is why this needs
 * no theme handling of its own.)
 *
 * Decorative: `aria-hidden`, `pointer-events-none`, and never `position: fixed` — the hero's own
 * transform is a containing block, the trap that once rendered the video modal at pill size.
 */

type Item = { icon: LucideIcon; title: string; desc: string };

/** Verbatim from SLASH_ITEMS — real commands, titles and descriptions. */
const BEATS = {
  note: {
    command: "/note",
    category: "Callouts",
    items: [
      { icon: Pencil, title: "Note", desc: "Neutral callout" },
      { icon: SquareStack, title: "Tabs", desc: "Tabbed content" },
      { icon: ListChecks, title: "Steps", desc: "Numbered steps" },
    ],
  },
  heading: {
    command: "/h1",
    category: "Basic blocks",
    items: [
      { icon: Heading1, title: "Heading 1", desc: "Big section heading" },
      { icon: Heading2, title: "Heading 2", desc: "Medium heading" },
    ],
  },
  text: {
    command: "/text",
    category: "Basic blocks",
    items: [
      { icon: Type, title: "Text", desc: "Plain paragraph" },
      { icon: Pencil, title: "Note", desc: "Neutral callout" },
    ],
  },
  card: {
    command: "/card",
    category: "Components",
    items: [
      { icon: LayoutGrid, title: "2 columns", desc: "Card grid" },
      { icon: SquareStack, title: "Card", desc: "Single card" },
    ],
  },
} satisfies Record<string, { command: string; category: string; items: Item[] }>;

export type BeatName = keyof typeof BEATS;

/**
 * One beat, positioned by the `relative` wrapper around the block it inserts — so it always sits
 * exactly where that block will appear, with no hard-coded offsets to drift when copy rewraps at
 * a different width.
 *
 * `delay` is when this beat starts typing; its block lands ~0.55s later.
 */
export function AuthoringBeat({ beat, delay }: { beat: BeatName; delay: number }) {
  const { command, category, items } = BEATS[beat];
  return (
    // Hidden below `sm:` — the menu would swamp a phone, where the hero should just be the hero.
    <span
      aria-hidden
      className="pv-authoring pointer-events-none absolute left-0 top-0 hidden select-none sm:block"
      // Each beat clears itself once its block has landed, so they don't pile up on screen.
      style={{ animationDelay: `${delay + 0.45}s` }}
    >
      <span className="mono inline-flex items-center gap-[1px] text-xs text-[var(--muted)]">
        <span
          className="pv-type"
          // A whole number of `ch` per character in a monospace face, so steps() advances one full
          // glyph at a time. A fractional width lands the steps mid-character and renders as
          // garbled text rather than as typing.
          style={{
            ["--pv-type-w" as string]: `${command.length}ch`,
            animationDelay: `${delay}s`,
            animationTimingFunction: `steps(${command.length}, end)`,
          }}
        >
          {command}
        </span>
        <span className="pv-caret h-3" style={{ animationDelay: `${delay}s` }} />
      </span>

      <span
        className="pv-authoring-menu absolute left-0 top-6 block"
        style={{ animationDelay: `${delay + 0.15}s` }}
      >
        <span className="pv-slash-menu block !w-[248px]">
          <span className="pv-slash-group block">
            <span className="pv-slash-category block">{category}</span>
            {items.map(({ icon: Icon, title, desc }, i) => (
              <span key={title} className={`pv-slash-item${i === 0 ? " is-active" : ""}`}>
                <span className="pv-slash-icon">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="pv-slash-text">
                  <span className="pv-slash-title">{title}</span>
                  <span className="pv-slash-desc">{desc}</span>
                </span>
              </span>
            ))}
          </span>
        </span>
      </span>
    </span>
  );
}
