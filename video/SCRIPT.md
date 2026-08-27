# Papervine — product tour video

**Format** 1920×1080, 30 fps · **Runtime** 3168 frames — 1:45.6
**Deliverable** `PapervineTour` composition in `src/PapervineVideo.tsx`

Twelve scenes, each in its own file under `src/scenes/`, joined by 12-frame transitions in a
`<TransitionSeries>`. Every scene is also registered as a standalone composition in the
`Scenes` folder of the Studio sidebar, so any one of them can be previewed, retimed, or
re-cut in isolation without scrubbing the full tour.

## How this is built

The product UI in this video is **rebuilt in React**, not screen-recorded. That's deliberate:

- it stays crisp at any resolution and re-renders when the product's real UI changes,
- every beat can be timed to the frame (a search palette opening on frame 40, a caret
  landing on frame 96) instead of being hostage to whatever the recording captured,
- no dev server, seeded database, or docker stack is needed to render the video.

Every colour is the real product token (`--bg #060609`, `--fg #ececf1`, `--muted #8a8a99`,
`--blue #5b8cff`, `--violet #a974ff`), and the fonts are the real stack — Space Grotesk for
display, Geist for body, Geist Mono for code.

## Audio

The cut carries a **music bed** — `audio/driftline-groove.mp3`, muxed at post rather than
rendered into the composition, truncated to the picture with a 2s fade-out (see the README).
There is no voiceover yet, so the narration column below is still a recording script.

The picture is also designed to **hold up muted**, the way a landing-page hero video is
actually watched: nothing it claims depends on being heard.

Each product scene carries **one quiet label** in the band below the shot — a single line at
body scale in a muted tone, naming what is on screen (`SceneCaption`). It is not a headline.
An earlier cut stacked a 46px marketing line over a mono list of feature words there; it
competed with the product for attention and read as an ad. The UI is the argument, so the
label only has to orient a viewer with the sound off. The scene sections below quote each
label under **Label**.

To add a voiceover, drop the file at `public/voiceover.mp3` and uncomment the `<Audio>` line in
`src/PapervineVideo.tsx`; the scene timings below are the alignment marks. Note that puts the VO
*inside* the render while the music is muxed *after* it — so once both exist, duck the music bed
in the mux step rather than fighting the two for level.

Word count is 268, which paces to ~105s at a conversational 150 wpm — a near-exact fit for
the 105.6s picture.

---

## Scene 1 · Cold open — the premise

**Frames 0–150 · 0:00.0 → 0:05.0**

> Your documentation has two audiences now. Your users — and the agents they ask instead.

**On screen** Black. A single line of 108px display type resolves: *"Your docs have two
audiences now."* Below it, two words fade up in sequence — **Humans.** then **and agents.**,
the second in the blue→violet brand gradient. A mono kicker underneath: `papervine.io`.

**Why it opens here** The problem the product solves is not "docs are hard to host" — that
market is solved. It's that the reader is now often a machine, and most docs stacks were
designed before that was true.

---

## Scene 2 · Brand

**Frames 138–258 · 0:04.6 → 0:08.6**

> Papervine. Documentation that grows itself.

**On screen** The logo mark scales in with a spring and blooms a soft violet glow; the
wordmark writes in beside it. The tagline sits below in muted 44px. This is the only scene
with no product UI in it — it exists to plant the name between the premise and the demo.

---

## Scene 3 · Connect a repo

**Frames 246–606 · 0:08.2 → 0:19.8**

> Point it at a repo of MDX and a `docs.json`. That's the config schema you already use — so
> an existing docs repo renders unchanged. Migration is a DNS switch, not a rewrite.

**On screen** Split frame. Left: a file tree (`docs.json`, `index.mdx`, `guides/`,
`api-reference/`) and a `docs.json` code panel that types itself in with real syntax
colouring. Right: a browser frame at `docs.acme.com` that boots the rendered site —
skeleton, then navigation, then content. A pill travels the gap between them and lands as
**Connected**.

**The claim being made** This is the migration story and it is the strongest thing the
product has to say to someone already paying a competitor, so it gets the first and longest
demo slot.

**Label** “An existing docs.json repository renders unchanged”

---

## Scene 4 · The rendered site

**Frames 594–924 · 0:19.8 → 0:30.4**

> You get a complete site: navigation, dark mode, and a full component library — cards, tabs,
> accordions, dual-theme code. An unknown component degrades gracefully instead of breaking
> the page.

**On screen** The browser frame fills the stage. The page scrolls: an `<h1>`, prose, a
`CardGroup` whose two cards stagger in, a `Tabs` block that switches tab, a code block with
dual-theme highlighting. At frame ~250 the appearance toggle flips the whole site to light
and back — one gesture, proving the theme is real and not a screenshot.

**Label** “Navigation, components, and both appearances”

---

## Scene 5 · Search

**Frames 912–1152 · 0:30.4 → 0:38.0**

> Search is already built. Command-K across every page, heading, and code block — re-indexed
> on every sync. Nothing extra to run.

**On screen** The site dims and blurs. A `⌘K` palette springs in. The query `reader auth`
types character by character; results land one after another — page hits, a heading hit, a
code-block hit — each with its matched substring in brand blue. A footer row shows the
`↑↓ navigate · ↵ open · esc` key hints.

**Label** “⌘K across every page, heading, and code block”

---

## Scene 6 · API playground

**Frames 1140–1410 · 0:38.0 → 0:46.6**

> Drop in an OpenAPI spec and get per-endpoint reference pages, in your navigation, with
> request and response schemas — and a live "Try it" panel.

**On screen** An `openapi.yaml` chip flies into the sidebar and unfolds into generated
endpoint entries with method badges (`GET`, `POST`, `DEL`). The main pane shows
`POST /v1/sites` with a parameter table, then the Try it panel fires: the button depresses,
a spinner, then `200 OK` and a JSON response that streams in line by line.

**Label** “Endpoint pages generated from your OpenAPI spec”

---

## Scene 7 · Visual editor, collaboration, editing agent

**Frames 1398–1818 · 0:46.6 → 1:00.2**

> Don't want to touch Git? Edit in the browser. A three-panel studio with real-time
> collaboration — you can see your teammates' cursors — and an editing agent that drafts with
> your docs as context. Publish as a commit, or open a pull request.

**On screen** The three-panel editor: file tree, the document, the agent panel. Two labelled
remote carets (**Dana**, **Sam**) move through the prose in different colours. In the agent
panel a prompt types — *"add a note about rate limits"* — the agent replies, and the drafted
`<Note>` block materialises in the document with a green added-line gutter. Then the Publish
menu opens: **Commit to main** / **Open pull request**.

**The longest scene, on purpose** This is the surface that separates the product from
docs-as-code tooling, and it has three things to say rather than one.

**Label** “Browser editing, live collaboration, and an editing agent”

---

## Scene 8 · AI assistant, and the widget

**Frames 1806–2166 · 1:00.2 → 1:11.8**

> Every visitor gets an assistant grounded in your content, answering with citations back to
> the page. Drop the same assistant into your own product with one script tag.

**On screen** Two halves. First the docs site with the assistant drawer open: a question,
then an answer streaming in with citation chips that name real pages. At frame ~200 the
frame slides to a *customer's* product — deliberately a different, lighter shell — where the
same assistant sits in a corner bubble, with the embed snippet on screen:
`<script src="https://papervine.io/widget.js" data-widget-id="…">`.

**Label** “Answers grounded in your docs, with citations”

---

## Scene 9 · Built for agents

**Frames 2154–2454 · 1:11.8 → 1:21.4**

> And it's built for the agents too. `llms.txt` and an MCP server out of the box — so your
> product shows up inside the AI tools your users already work in.

**On screen** Left: a mono panel serving `/llms.txt` — the site's own map, in plain text.
Right: an agent session making a real tool call, `search_docs("reader auth")`, and receiving
structured results. Three chips underneath: `llms.txt`, `llms-full.txt`, `MCP`.

**Label** “llms.txt and an MCP server, out of the box”

---

## Scene 10 · Public and private, one site

**Frames 2442–2712 · 1:21.4 → 1:30.0**

> Public docs and internal docs, one site. Gate a page to a reader group with one line of
> frontmatter. Readers sign in through your own identity provider.

**On screen** A frontmatter block types out and the line `groups: ["staff"]` highlights and
holds. Beside it, the navigation: as the gate applies, *Internal runbook* and *On-call* fade
out of the list entirely — the point being they don't render as locked rows, they aren't
there. A pill flips from **reader: public** to **reader: staff** and the two pages return.

**Label** “Page-level access control from one line of frontmatter”

---

## Scene 11 · Analytics — humans vs. agents

**Frames 2700–2940 · 1:30.0 → 1:38.0**

> See what people read and search for. Then flip one toggle and see the same site through the
> eyes of the agents crawling it.

**On screen** A dashboard panel: a traffic area chart, top pages, top searches. A segmented
**Humans / Agents** control slides to *Agents* and the whole panel re-animates — the chart
redraws, and top pages becomes a list of crawler user agents (`ChatGPT-User`, `ClaudeBot`,
`PerplexityBot`, `Googlebot`) with their own counts.

**Label** “Traffic from people, and from agents”

---

## Scene 12 · Close

**Frames 2928–3168 · 1:38.0 → 1:45.6**

> Your docs are your best sales engineer. Papervine dot io — open source, and free to start.

**On screen** Back to black. The wordmark, then the line *"Make your docs a competitive
advantage."* in 84px. A gradient CTA pill: **papervine.io**. A mono footer:
`open source · docs.json-native · free to start`. The violet glow breathes once and the frame
holds two beats before cutting.

---

## Timing table

| # | Scene | Start | Frames | Duration | Timecode |
|---|---|---|---|---|---|
| 1 | Cold open | 0 | 150 | 5.0s | 0:00.0 |
| 2 | Brand | 138 | 120 | 4.0s | 0:04.6 |
| 3 | Connect | 246 | 360 | 12.0s | 0:08.2 |
| 4 | Rendered site | 594 | 330 | 11.0s | 0:19.8 |
| 5 | Search | 912 | 240 | 8.0s | 0:30.4 |
| 6 | API playground | 1140 | 270 | 9.0s | 0:38.0 |
| 7 | Editor | 1398 | 420 | 14.0s | 0:46.6 |
| 8 | Assistant + widget | 1806 | 360 | 12.0s | 1:00.2 |
| 9 | Built for agents | 2154 | 300 | 10.0s | 1:11.8 |
| 10 | Reader auth | 2442 | 270 | 9.0s | 1:21.4 |
| 11 | Analytics | 2700 | 240 | 8.0s | 1:30.0 |
| 12 | Close | 2928 | 240 | 8.0s | 1:38.0 |

Each transition is 12 frames and overlaps the two scenes it joins, so the total is
`3300 − (11 × 12) = 3168` frames.

## What is claimed, and where it comes from

Every capability shown is a shipped one, sourced from the product's own docs and marketing:
`docs.json` compatibility, MDX components with graceful degradation, ⌘K search, the
OpenAPI-generated playground, the browser editor with live collaboration and an editing
agent, the grounded assistant and its embeddable widget, `llms.txt` + MCP, reader-group
page gating via frontmatter, and the humans-vs-agents analytics toggle. Nothing in the
narration is aspirational — if a feature moves, the scene should move with it.

Names and data on screen (`docs.acme.com`, Dana, Sam, the crawler counts) are invented
sample data. No real customer appears in this video.
