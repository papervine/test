import { common, createLowlight } from "lowlight";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import http from "highlight.js/lib/languages/http";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";

/**
 * The Visual editor's syntax highlighter.
 *
 * Published pages are highlighted by **Shiki** at compile time, which is a server-side,
 * asynchronous, WASM-backed affair — none of which a keystroke can wait for. In the editor the
 * highlighting is ProseMirror decorations recomputed on every change, so it has to be synchronous
 * and cheap: that's lowlight (highlight.js). The grammars differ in the margins, so the editor's
 * colours are tuned to `github-dark`/`github-light` (see `platform.css`) — the same themes the
 * renderer uses — rather than to highlight.js's own stylesheet.
 *
 * The registry is explicit because of what happens when a language ISN'T registered: TipTap's
 * lowlight plugin falls back to `highlightAuto`, which *guesses*. A ```mermaid fence coloured as
 * somebody's guess at Ruby is worse than no colour at all, so the languages we offer but have no
 * grammar for are aliased to a grammar that produces nothing.
 */
export const lowlight = createLowlight(common);

// `common` is highlight.js's 37-language bundle; these are the ones the picker offers that it
// leaves out. Everything else in CODE_LANGUAGES is already in `common`, usually under an alias
// (`ts` → typescript, `js`/`jsx` → javascript, `toml` → ini, `sh` → bash).
lowlight.register({ dockerfile, elixir, groovy, haskell, http, nginx, powershell, scala });

// MDX is markdown for colouring purposes. Mermaid and Prisma have no grammar here, and would
// otherwise be auto-detected as whatever they most resemble — plaintext leaves them alone.
lowlight.registerAlias({
  markdown: ["mdx"],
  plaintext: ["mermaid", "prisma", "text", "txt"],
});
