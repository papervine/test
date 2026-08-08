/**
 * The embeddable assistant widget's browser-side script (SPEC §8.7) — served verbatim by
 * `src/app/api/widget/embed.js/route.ts` at `/api/widget/embed.js`.
 *
 * Deliberately plain, dependency-free, modern JS (no TypeScript syntax, no framework, no
 * build step) — this repo has no bundler anywhere (checked: no esbuild/tsup/vite/rollup in
 * any package.json), and introducing one for a single small script isn't worth it. A
 * template-literal string constant (not a file read via `fs`) is served directly so
 * Vercel's serverless bundler includes it via a normal `import`, with no runtime
 * filesystem access needed.
 *
 * Mounted into a shadow root so the host page's CSS can never bleed in or out. The
 * assistant's answer is rendered as real markdown (headings, lists, links, bold/italic,
 * code) via a small hand-rolled renderer that builds DOM NODES directly (never assigns
 * `innerHTML` from model output) — every piece of text goes through
 * `document.createTextNode`, so it's injection-safe by construction with no HTML-escaping
 * step to get right or forget. This is the same reasoning that ruled out a bundler: a
 * markdown-parser dependency wasn't worth it either, so this renders the small common
 * subset (headings, lists, links, bold/italic, code/fences) by hand instead.
 *
 * Every AGENTIC STEP the model takes streams its own text segment (bounded by
 * `text-start`/`text-end`), and the model narrates between tool calls ("let me check
 * the intro page…") as well as giving the real final answer — those are ALL separate
 * segments on the wire. Only the LAST segment is the answer; earlier ones are the
 * model "thinking out loud" mid-search. The UI shows only the current segment (reset on
 * every `text-start`), not a running concatenation of all of them, and shows a
 * "Searching the docs…" placeholder while a tool call is in flight with nothing to show
 * yet — matching how the in-docs Assistant UI reads, even though it can't literally
 * reuse those React/AI-Elements components here (that would mean shipping React +
 * Tailwind into someone else's page, exactly what avoiding a bundler was for).
 */
export const WIDGET_EMBED_SCRIPT = `
(function () {
  if (window.PapervineAssistant) return;

  var API_BASE = new URL(import.meta.url).origin;

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (k === "style") node.style.cssText = props[k];
        else node.setAttribute(k, props[k]);
      }
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function text(s) {
    return document.createTextNode(s);
  }

  // Reject anything that isn't clearly a safe link target (http(s)/relative/hash) — a
  // crafted "javascript:" markdown link must never become a real href. A "/"-rooted
  // relative URL is made absolute against \`base\` (the tenant's real docs origin, from
  // the X-Papervine-Docs-Base response header — see streamEvents below) — the model's
  // citation links are written as if they were on the docs site itself (e.g.
  // "[Quickstart](/quickstart)"), but the widget renders inside an arbitrary CUSTOMER
  // page, where a bare "/quickstart" would otherwise resolve against THEIR origin.
  function safeHref(url, base) {
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/") return base ? base + url : url;
    if (url.charAt(0) === "#") return url;
    return "#";
  }

  // Hand-rolled inline markdown (bold/italic/code/links) — returns an array of DOM nodes,
  // never a raw HTML string. No regex: character-by-character scanning avoids the
  // escaping pitfalls of embedding backslash/backtick-heavy regex literals inside this
  // already-templated script, and is easy to reason about directly.
  function renderInlineNodes(s, base) {
    var nodes = [];
    var i = 0;
    while (i < s.length) {
      if (s.slice(i, i + 2) === "**") {
        var boldEnd = s.indexOf("**", i + 2);
        if (boldEnd !== -1) {
          nodes.push(el("strong", null, renderInlineNodes(s.slice(i + 2, boldEnd), base)));
          i = boldEnd + 2;
          continue;
        }
      }
      if (s.charAt(i) === "\`") {
        var codeEnd = s.indexOf("\`", i + 1);
        if (codeEnd !== -1) {
          nodes.push(el("code", null, [text(s.slice(i + 1, codeEnd))]));
          i = codeEnd + 1;
          continue;
        }
      }
      if (s.charAt(i) === "!" && s.charAt(i + 1) === "[") {
        var imgCloseBracket = s.indexOf("]", i + 2);
        if (imgCloseBracket !== -1 && s.charAt(imgCloseBracket + 1) === "(") {
          var imgCloseParen = s.indexOf(")", imgCloseBracket + 2);
          if (imgCloseParen !== -1) {
            var altText = s.slice(i + 2, imgCloseBracket);
            var imgSrc = s.slice(imgCloseBracket + 2, imgCloseParen);
            nodes.push(el("img", { src: safeHref(imgSrc, base), alt: altText }));
            i = imgCloseParen + 1;
            continue;
          }
        }
      }
      if (s.charAt(i) === "[") {
        var closeBracket = s.indexOf("]", i + 1);
        if (closeBracket !== -1 && s.charAt(closeBracket + 1) === "(") {
          var closeParen = s.indexOf(")", closeBracket + 2);
          if (closeParen !== -1) {
            var label = s.slice(i + 1, closeBracket);
            var url = s.slice(closeBracket + 2, closeParen);
            nodes.push(
              el("a", { href: safeHref(url, base), target: "_blank", rel: "noreferrer" }, [text(label)]),
            );
            i = closeParen + 1;
            continue;
          }
        }
      }
      if (s.charAt(i) === "*" && s.charAt(i + 1) !== "*") {
        var italicEnd = s.indexOf("*", i + 1);
        if (italicEnd !== -1) {
          nodes.push(el("em", null, renderInlineNodes(s.slice(i + 1, italicEnd), base)));
          i = italicEnd + 1;
          continue;
        }
      }
      var start = i;
      while (i < s.length && s.charAt(i) !== "*" && s.charAt(i) !== "\`" && s.charAt(i) !== "[" && s.charAt(i) !== "!") i++;
      if (i === start) i++;
      nodes.push(text(s.slice(start, i)));
    }
    return nodes;
  }

  // GFM table row: split on "|", trimming one leading/trailing empty cell from a row
  // that starts/ends with "|" (both optional in GFM). Doesn't handle an escaped "\\|"
  // inside a cell — an acceptable gap at this renderer's level of sophistication.
  function splitTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    return t.split("|").map(function (c) { return c.trim(); });
  }

  // A table's separator row (the line between the header and body, e.g. "| --- | :-: |")
  // — every cell is made of only "-" and ":", with at least one "-".
  function isSeparatorRow(cells) {
    if (!cells.length) return false;
    for (var c = 0; c < cells.length; c++) {
      var cell = cells[c];
      if (!cell) return false;
      var hasDash = false;
      for (var j = 0; j < cell.length; j++) {
        var ch = cell.charAt(j);
        if (ch === "-") hasDash = true;
        else if (ch !== ":") return false;
      }
      if (!hasDash) return false;
    }
    return true;
  }

  // Parse one line as a list item: leading-space indent + a "- "/"* " (ul) or "1. " (ol)
  // marker. Returns null for a non-list-item line. Indent is what makes nesting possible —
  // a deeper-indented run of items immediately under a sibling item becomes that
  // sibling's nested sub-list (buildListTree below).
  function listItemInfo(line) {
    var indent = 0;
    while (indent < line.length && line.charAt(indent) === " ") indent++;
    var rest = line.slice(indent);
    if ((rest.charAt(0) === "-" || rest.charAt(0) === "*") && rest.charAt(1) === " ") {
      return { indent: indent, tag: "ul", content: rest.slice(2) };
    }
    var d = 0;
    while (d < rest.length && rest.charAt(d) >= "0" && rest.charAt(d) <= "9") d++;
    if (d > 0 && rest.slice(d, d + 2) === ". ") {
      return { indent: indent, tag: "ol", content: rest.slice(d + 2) };
    }
    return null;
  }

  // Recursive-descent over a flat run of listItemInfo entries: siblings share the same
  // indent + tag; an item immediately followed by a MORE-indented item nests a sub-list
  // inside that item's <li>. Returns where the caller (a shallower level, or the top-level
  // loop) should resume.
  function buildListTree(items, start, indent, base) {
    var tag = items[start].tag;
    var lis = [];
    var idx = start;
    while (idx < items.length && items[idx].indent === indent && items[idx].tag === tag) {
      var li = el("li", null, renderInlineNodes(items[idx].content, base));
      idx++;
      if (idx < items.length && items[idx].indent > indent) {
        var nested = buildListTree(items, idx, items[idx].indent, base);
        li.appendChild(nested.node);
        idx = nested.next;
      }
      lis.push(li);
    }
    return { node: el(tag, null, lis), next: idx };
  }

  // Real diagram rendering, loaded on demand (SPEC §8.7) — pinned to an EXACT mermaid
  // version (never a floating tag) so it can't silently change under us; mermaid's own
  // recommended no-bundler embedding pattern. Its real distribution is dozens of
  // interlinked chunk files (some hundreds of KB each), not one self-contained script —
  // that ruled out fetching+verifying a pinned content hash ourselves (the chunks' own
  // relative imports can't resolve from a blob: URL, and pinning/verifying every chunk
  // individually isn't maintainable across mermaid version bumps). So this is a real
  // third-party runtime dependency, narrower than a vendored/hash-verified one — trusted
  // no further than "this exact, immutable jsdelivr version", same trust model as any
  // versioned CDN import. securityLevel:"strict" sanitizes the DIAGRAM CONTENT (HTML in
  // labels/tooltips) since that still originates from the model's output.
  var MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.16.1/dist/mermaid.esm.min.mjs";
  var mermaidPromise = null;
  function loadMermaid() {
    if (!mermaidPromise) mermaidPromise = import(MERMAID_URL).then(function (mod) { return mod.default; });
    return mermaidPromise;
  }

  // Replace each mermaid fence's fallback (raw source, shown immediately while this
  // resolves) with a rendered SVG. Called once per completed turn, never mid-stream — a
  // diagram fence isn't reliably complete until the whole answer has streamed in. Any
  // failure (network, CSP block, invalid diagram syntax) leaves the fallback exactly as
  // it already was — a diagram must never break the rest of the answer.
  // Returns a promise that settles once every diagram in \`container\` has either
  // upgraded to a real SVG or fallen back — never rejects itself (each diagram's own
  // failure is caught individually), so a caller can safely await it either way.
  // \`theme\` ("dark" by default, matching this script's own default) picks mermaid's own
  // color scheme — otherwise a diagram renders with mermaid's light default node fills,
  // clashing with a dark panel around it. initialize() is called fresh each time (cheap,
  // no re-fetch) since it's the only way to pick the theme per render — mermaid has no
  // per-call theme override on render() itself.
  function upgradeMermaidDiagrams(container, theme) {
    var wraps = container.querySelectorAll(".pv-mermaid");
    var settled = [];
    for (var w = 0; w < wraps.length; w++) {
      (function (wrap) {
        var source = wrap.getAttribute("data-source");
        settled.push(
          loadMermaid()
            .then(function (mermaid) {
              mermaid.initialize({
                startOnLoad: false,
                securityLevel: "strict",
                theme: theme === "light" ? "default" : "dark",
              });
              return mermaid.render("pv-mmd-" + Math.random().toString(36).slice(2), source);
            })
            .then(function (result) {
              while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
              var svgHost = el("div", { class: "pv-mermaid-svg" });
              // mermaid's OWN sanitized output (securityLevel: "strict" above), not raw
              // model text — the one deliberate innerHTML use in this whole script, same
              // as how any app embedding mermaid renders its result.
              svgHost.innerHTML = result.svg;
              wrap.appendChild(svgHost);
            })
            .catch(function () {
              // Leave the fallback as-is (it already shows the raw source) — just clear
              // the "rendering…" note back to the original, no-JS-needed message.
              var note = wrap.querySelector(".pv-note");
              if (note) note.textContent = "Diagram — view the full page in the docs to see it rendered:";
            }),
        );
      })(wraps[w]);
    }
    return Promise.all(settled);
  }

  // Block-level markdown (headings, lists, fenced code, tables, blockquotes, rules,
  // paragraphs) — appends real DOM nodes into \`container\` (clearing it first). Same
  // no-innerHTML, no-regex reasoning as renderInlineNodes above.
  function renderMarkdownInto(container, raw, base) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var lines = raw.split("\\n");
    var i = 0;
    var para = [];

    function flushPara() {
      if (para.length) {
        container.appendChild(el("p", null, renderInlineNodes(para.join(" "), base)));
        para = [];
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (line.slice(0, 3) === "\`\`\`") {
        flushPara();
        var lang = line.slice(3).trim();
        var code = [];
        i++;
        while (i < lines.length && lines[i].slice(0, 3) !== "\`\`\`") {
          code.push(lines[i]);
          i++;
        }
        i++;
        var codeText = code.join("\\n");
        if (lang === "mermaid") {
          // Shown immediately; upgradeMermaidDiagrams (called once per completed turn,
          // never mid-stream) replaces this with a rendered SVG if the on-demand mermaid
          // load succeeds, or leaves it exactly as-is if it doesn't.
          container.appendChild(
            el("div", { class: "pv-mermaid", "data-source": codeText }, [
              el("p", { class: "pv-note" }, [text("Diagram — rendering…")]),
              el("pre", null, [el("code", null, [text(codeText)])]),
            ]),
          );
        } else {
          container.appendChild(el("pre", null, [el("code", null, [text(codeText)])]));
        }
        continue;
      }

      if (line.indexOf("|") !== -1 && i + 1 < lines.length) {
        var headerCells = splitTableRow(line);
        var sepCells = splitTableRow(lines[i + 1]);
        if (headerCells.length > 0 && isSeparatorRow(sepCells)) {
          flushPara();
          var thead = el(
            "thead",
            null,
            [el("tr", null, headerCells.map(function (c) { return el("th", null, renderInlineNodes(c, base)); }))],
          );
          var bodyRows = [];
          i += 2;
          while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") {
            var rowCells = splitTableRow(lines[i]);
            bodyRows.push(
              el("tr", null, rowCells.map(function (c) { return el("td", null, renderInlineNodes(c, base)); })),
            );
            i++;
          }
          container.appendChild(el("table", null, [thead, el("tbody", null, bodyRows)]));
          continue;
        }
      }

      var level = 0;
      while (level < line.length && line.charAt(level) === "#" && level < 6) level++;
      if (level > 0 && line.charAt(level) === " ") {
        flushPara();
        container.appendChild(el("h" + level, null, renderInlineNodes(line.slice(level + 1), base)));
        i++;
        continue;
      }

      // A line of 3+ repeats of the SAME "-"/"*"/"_" and nothing else is a horizontal
      // rule — checked before list-item detection since "---" would otherwise almost
      // (but not quite; list items need a space after the marker) look like one.
      var ruleTrim = line.trim();
      var ruleChar = ruleTrim.charAt(0);
      var isRule =
        ruleTrim.length >= 3 &&
        (ruleChar === "-" || ruleChar === "*" || ruleChar === "_");
      if (isRule) {
        for (var ri = 1; ri < ruleTrim.length; ri++) {
          if (ruleTrim.charAt(ri) !== ruleChar) {
            isRule = false;
            break;
          }
        }
      }
      if (isRule) {
        flushPara();
        container.appendChild(el("hr", null));
        i++;
        continue;
      }

      if (line.charAt(0) === ">") {
        flushPara();
        var quoteLines = [];
        while (i < lines.length && lines[i].charAt(0) === ">") {
          var q = lines[i].slice(1);
          if (q.charAt(0) === " ") q = q.slice(1);
          quoteLines.push(q);
          i++;
        }
        container.appendChild(el("blockquote", null, renderInlineNodes(quoteLines.join(" "), base)));
        continue;
      }

      var firstItem = listItemInfo(line);
      if (firstItem) {
        flushPara();
        // Consume the WHOLE contiguous list run (including nested/indented lines and
        // blank lines immediately followed by another item) in one pass, then build the
        // nested tree in one shot — rather than emitting one flat <ul> per line, which is
        // what silently dropped indentation before.
        var items = [firstItem];
        i++;
        for (;;) {
          var next = i < lines.length ? listItemInfo(lines[i]) : null;
          if (next) {
            items.push(next);
            i++;
          } else if (i < lines.length && lines[i].trim() === "" && i + 1 < lines.length && listItemInfo(lines[i + 1])) {
            i++;
          } else {
            break;
          }
        }
        // buildListTree stops as soon as it hits an item that isn't a sibling at the
        // SAME tag+indent it started with (a real list→list tag change, e.g. ul then ol
        // across a blank line, collected into the same run above) — loop until every
        // collected item has actually been rendered, or the leftover tail is silently
        // dropped instead of shown as its own adjacent list.
        var listIdx = 0;
        while (listIdx < items.length) {
          var built = buildListTree(items, listIdx, items[listIdx].indent, base);
          container.appendChild(built.node);
          listIdx = built.next;
        }
        continue;
      }

      if (line.trim() === "") {
        flushPara();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }
    flushPara();
  }

  // Themeable via CSS custom properties, toggled by a class on the HOST element (the
  // outer <div> — :host(.pv-theme-light) targets it from inside its own shadow root).
  // Dark is the default look (opts.theme in mount() below); "light"/"system" swap this
  // one block of variables rather than duplicating every rule per theme.
  var STYLE = [
    ":host { all: initial;",
    "  --pv-bg: #0c0c0d; --pv-fg: rgba(255,255,255,0.92); --pv-muted: rgba(255,255,255,0.5);",
    "  --pv-border: rgba(255,255,255,0.09); --pv-surface: rgba(255,255,255,0.05);",
    "  --pv-surface-hover: rgba(255,255,255,0.09); --pv-accent: #fff; --pv-accent-fg: #0c0c0d;",
    "  --pv-link: #8ab4ff; --pv-code-bg: rgba(255,255,255,0.09); --pv-shadow: rgba(0,0,0,0.5);",
    // Not theme-dependent, so declared once here rather than repeated in the light
    // override below — opts.accent/radius/font/zIndex set these as inline styles on the
    // host element itself (per-instance dynamic values, not baked into this shared
    // stylesheet), which still cascade into the shadow tree's var() lookups.
    "  --pv-radius: 16px; --pv-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;",
    "  --pv-zindex: 2147483000; }",
    ":host(.pv-theme-light) {",
    "  --pv-bg: #fff; --pv-fg: rgba(0,0,0,0.88); --pv-muted: rgba(0,0,0,0.5);",
    "  --pv-border: rgba(0,0,0,0.08); --pv-surface: rgba(0,0,0,0.04);",
    "  --pv-surface-hover: rgba(0,0,0,0.07); --pv-accent: #111; --pv-accent-fg: #fff;",
    "  --pv-link: #2563eb; --pv-code-bg: rgba(0,0,0,0.06); --pv-shadow: rgba(0,0,0,0.28); }",
    "* { box-sizing: border-box; font-family: var(--pv-font); }",
    // Always dark, independent of the panel's theme and NOT affected by opts.accent —
    // it floats on an arbitrary host page whose background we don't control, so it
    // needs to read clearly against either a light or a dark page. Only the opened
    // panel follows opts.theme/accent. .pv-launcher-text is a pill shape (opts.trigger
    // text instead of the bare emoji) rather than the default circle.
    ".pv-launcher { position: fixed; width: 56px; height: 56px; border-radius: 50%;",
    "  background: #111; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.35);",
    "  font-size: 24px; z-index: var(--pv-zindex); display: flex; align-items: center; justify-content: center; }",
    ".pv-launcher img { width: 28px; height: 28px; border-radius: 50%; }",
    ".pv-launcher.pv-launcher-text { width: auto; height: 48px; padding: 0 20px; border-radius: 24px;",
    "  font-size: 14px; font-weight: 600; gap: 8px; }",
    ".pv-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: var(--pv-zindex);",
    "  display: none; }",
    ".pv-backdrop.open { display: block; }",
    ".pv-panel { position: fixed; width: 360px; max-width: calc(100vw - 40px); height: 480px;",
    "  max-height: calc(100vh - 120px); background: var(--pv-bg); color: var(--pv-fg);",
    "  border-radius: var(--pv-radius); box-shadow: 0 8px 32px var(--pv-shadow); display: none;",
    "  flex-direction: column; overflow: hidden; z-index: var(--pv-zindex); border: 1px solid var(--pv-border); }",
    ".pv-panel.open { display: flex; }",
    // "modal": centered overlay, independent of side/align (those position the launcher
    // and the default "widget" variant's anchored panel only).
    ".pv-panel.pv-variant-modal { top: 50%; left: 50%; transform: translate(-50%, -50%);",
    "  bottom: auto; right: auto; width: 420px; height: 600px; max-height: calc(100vh - 80px); }",
    // "panel": full-height, docked to the right edge, square corners on the screen edge.
    ".pv-panel.pv-variant-panel { top: 0; right: 0; bottom: 0; left: auto; height: 100vh;",
    "  max-height: 100vh; width: 380px; max-width: 100vw; border-radius: 0; border-width: 0 0 0 1px; }",
    ".pv-header { display: flex; align-items: center; justify-content: space-between; gap: 8px;",
    "  padding: 12px 14px; border-bottom: 1px solid var(--pv-border); font-size: 14px; font-weight: 600; }",
    ".pv-header-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".pv-support { font-size: 12px; font-weight: 400; color: var(--pv-muted); text-decoration: none;",
    "  white-space: nowrap; }",
    ".pv-support:hover { color: var(--pv-fg); }",
    ".pv-close { border: none; background: none; color: var(--pv-muted); cursor: pointer; font-size: 16px;",
    "  line-height: 1; padding: 4px; border-radius: 6px; flex-shrink: 0; }",
    ".pv-close:hover { background: var(--pv-surface-hover); color: var(--pv-fg); }",
    ".pv-disclaimer { padding: 10px 14px; font-size: 11.5px; line-height: 1.4; color: var(--pv-muted);",
    "  text-align: center; border-bottom: 1px solid var(--pv-border); }",
    ".pv-messages { flex: 1; overflow-y: auto; padding: 12px 14px; font-size: 14px; line-height: 1.5; }",
    ".pv-messages::-webkit-scrollbar { width: 8px; }",
    ".pv-messages::-webkit-scrollbar-thumb { background: var(--pv-surface-hover); border-radius: 4px; }",
    ".pv-suggestions-heading { display: flex; align-items: center; gap: 6px; font-size: 12px;",
    "  color: var(--pv-muted); margin-bottom: 8px; }",
    ".pv-suggestion { display: block; width: 100%; text-align: left; background: var(--pv-surface);",
    "  border: 1px solid var(--pv-border); color: var(--pv-fg); border-radius: 10px; padding: 8px 12px;",
    "  font-size: 13px; margin-bottom: 6px; cursor: pointer; }",
    ".pv-suggestion:hover { background: var(--pv-surface-hover); }",
    ".pv-msg { margin-bottom: 12px; word-break: break-word; }",
    ".pv-msg.user { text-align: right; white-space: pre-wrap; }",
    ".pv-msg.user > span { display: inline-block; background: var(--pv-surface); border-radius: 12px; padding: 6px 12px; text-align: left; }",
    ".pv-msg.assistant { text-align: left; color: var(--pv-fg); }",
    ".pv-msg.error { color: #f87171; white-space: pre-wrap; }",
    ".pv-msg p { margin: 0 0 8px; }",
    ".pv-msg p:last-child { margin-bottom: 0; }",
    ".pv-msg h1, .pv-msg h2, .pv-msg h3, .pv-msg h4, .pv-msg h5, .pv-msg h6 { margin: 12px 0 6px; font-weight: 600; line-height: 1.3; }",
    ".pv-msg h1 { font-size: 17px; } .pv-msg h2 { font-size: 15.5px; } .pv-msg h3, .pv-msg h4, .pv-msg h5, .pv-msg h6 { font-size: 14px; }",
    ".pv-msg ul, .pv-msg ol { margin: 6px 0; padding-left: 20px; }",
    ".pv-msg li { margin: 2px 0; }",
    ".pv-msg code { background: var(--pv-code-bg); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }",
    ".pv-msg pre { background: var(--pv-surface); border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }",
    ".pv-msg pre code { background: none; padding: 0; }",
    ".pv-msg table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12.5px; }",
    ".pv-msg th, .pv-msg td { border: 1px solid var(--pv-border); padding: 4px 8px; text-align: left; vertical-align: top; }",
    ".pv-msg th { background: var(--pv-surface); font-weight: 600; }",
    ".pv-msg a { color: var(--pv-link); text-decoration: underline; }",
    ".pv-msg em { font-style: italic; }",
    ".pv-msg blockquote { margin: 6px 0; padding: 2px 10px; border-left: 3px solid var(--pv-border); color: var(--pv-muted); }",
    ".pv-msg hr { border: none; border-top: 1px solid var(--pv-border); margin: 10px 0; }",
    ".pv-msg ul ul, .pv-msg ol ol, .pv-msg ul ol, .pv-msg ol ul { margin: 2px 0; }",
    ".pv-msg img { max-width: 100%; border-radius: 6px; margin: 4px 0; display: block; }",
    ".pv-msg .pv-note { font-size: 12px; color: var(--pv-muted); margin: 6px 0 2px; }",
    ".pv-mermaid-svg { margin: 6px 0; }",
    ".pv-mermaid-svg svg { max-width: 100%; height: auto; }",
    ".pv-inputrow { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--pv-border); }",
    ".pv-input { flex: 1; border: 1px solid var(--pv-border); background: var(--pv-surface); color: var(--pv-fg);",
    "  border-radius: 20px; padding: 9px 14px; font-size: 14px; outline: none; }",
    ".pv-input::placeholder { color: var(--pv-muted); }",
    ".pv-send { border: none; background: var(--pv-accent); color: var(--pv-accent-fg); border-radius: 50%;",
    "  width: 34px; height: 34px; flex-shrink: 0; font-size: 15px; line-height: 1; cursor: pointer; }",
    ".pv-send:disabled { opacity: 0.4; cursor: default; }",
  ].join("\\n");

  // Yields every parsed SSE event on the wire (not just text-delta) so the caller can tell
  // segment boundaries (text-start/text-end) and tool-call activity (start-step,
  // tool-input-start) apart from the running answer text. \`meta\`, if supplied, gets its
  // \`docsBase\` field set from the X-Papervine-Docs-Base response header (the server's
  // Access-Control-Expose-Headers allowlist is what makes it readable here at all — a
  // custom header on a cross-origin response is invisible to JS otherwise) before any
  // event is emitted, so a caller reading meta.docsBase inside onEvent always sees it.
  async function streamEvents(widgetId, messages, onEvent, meta) {
    var res = await fetch(API_BASE + "/api/widget/" + widgetId + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages }),
    });
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      throw new Error(body.error || ("Request failed (" + res.status + ")"));
    }
    if (meta) meta.docsBase = res.headers.get("X-Papervine-Docs-Base") || "";
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var lines = buffer.split("\\n");
      buffer = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.startsWith("data: ")) continue;
        var payload = line.slice(6);
        if (payload === "[DONE]") return;
        var event;
        try {
          event = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        onEvent(event);
      }
    }
  }

  // "dark" (this script's default look), "light", or "system" (follows the host page's
  // prefers-color-scheme at mount time — not re-checked live if it changes afterward).
  function resolveTheme(theme) {
    if (theme === "light") return "light";
    if (theme === "system") {
      var prefersLight =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
      return prefersLight ? "light" : "dark";
    }
    return "dark";
  }

  // opts.side picks which screen edge an element anchors to; opts.align positions it
  // along that edge (perpendicular axis). "inline-start"/"inline-end" are treated as
  // left/right (no RTL-aware direction detection — a deliberate simplification). The
  // inset param shifts the anchor further from the edge (used for the panel, so it
  // clears the launcher's own footprint rather than overlapping it).
  function edgePositionCss(side, align, inset) {
    var s = side === "inline-start" ? "left" : side === "inline-end" ? "right" : side || "bottom";
    var a = align || "end";
    var horizontal = s === "top" || s === "bottom";
    var css = "position: fixed; " + s + ": " + inset + "px; ";
    if (a === "start") css += (horizontal ? "left" : "top") + ": 20px;";
    else if (a === "center") {
      var prop = horizontal ? "left" : "top";
      var axis = horizontal ? "X" : "Y";
      css += prop + ": 50%; transform: translate" + axis + "(-50%);";
    } else css += (horizontal ? "right" : "bottom") + ": 20px;";
    return css;
  }

  // Fire opts.event({type, ...extra}) / opts.error({code, retryable, status}) if the
  // caller supplied one — wrapped in try/catch so a customer's own buggy hook can never
  // break the widget itself.
  function fireEvent(opts, type, extra) {
    if (typeof opts.event !== "function") return;
    try {
      var payload = { type: type, actor: "system" };
      for (var k in extra) payload[k] = extra[k];
      opts.event(payload);
    } catch (e) {
      /* a customer's own hook throwing is their bug, not ours to propagate */
    }
  }
  function fireError(opts, err) {
    if (typeof opts.error !== "function") return;
    try {
      opts.error({
        code: (err && err.code) || "request_failed",
        retryable: !!(err && err.retryable),
        status: err && err.status,
      });
    } catch (e) {
      /* same as fireEvent */
    }
  }

  // Returns a controller { open, close, ask, update, reset, destroy } — the runtime
  // methods exposed on window.PapervineAssistant delegate to whichever instance is
  // currently mounted (see the bottom of this file).
  function mount(opts) {
    var widgetId = opts.id;
    var messages = [];
    var theme = resolveTheme(opts.theme);

    var host = el("div");
    if (theme === "light") host.classList.add("pv-theme-light");
    // opts.accent/radius/font/zIndex are per-instance dynamic values, not baked into
    // the shared stylesheet — set as inline custom properties on the host element,
    // which still cascade into the shadow tree's var() lookups across the boundary.
    var hostCss = "";
    if (opts.accent) hostCss += "--pv-accent:" + opts.accent + ";--pv-link:" + opts.accent + ";";
    if (opts.radius) hostCss += "--pv-radius:" + opts.radius + ";";
    if (opts.font) hostCss += "--pv-font:" + opts.font + ";";
    if (opts.zIndex) hostCss += "--pv-zindex:" + opts.zIndex + ";";
    if (hostCss) host.style.cssText = hostCss;
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    // opts.nonce: copied onto the one <style> tag this script creates, for a host page
    // with a strict style-src CSP that requires nonces on injected stylesheets.
    root.appendChild(el("style", opts.nonce ? { nonce: opts.nonce } : null, [text(STYLE)]));

    var variant = opts.variant === "modal" || opts.variant === "panel" ? opts.variant : "widget";

    var messagesEl = el("div", { class: "pv-messages" });
    var inputEl = el("input", { class: "pv-input", placeholder: opts.placeholder || "Ask a question…" });
    var sendEl = el("button", { class: "pv-send", "aria-label": "Send" }, [text("↑")]);
    var closeEl = el("button", { class: "pv-close", "aria-label": "Close" }, [text("✕")]);
    var titleEl = el("span", { class: "pv-header-title" }, [text(opts.title || "Ask the docs assistant")]);
    var headerChildren = [titleEl];
    if (opts.supportEmail) {
      headerChildren.push(
        el("a", { class: "pv-support", href: "mailto:" + opts.supportEmail }, [text("Contact support")]),
      );
    }
    headerChildren.push(closeEl);

    var panelChildren = [el("div", { class: "pv-header" }, headerChildren)];
    if (opts.disclaimer !== false) {
      panelChildren.push(
        el("div", { class: "pv-disclaimer" }, [
          text(opts.disclaimer || "Responses are generated using AI and may contain mistakes."),
        ]),
      );
    }

    // Up to 3 empty-state prompts, shown until the first message is sent (send()
    // removes suggestionsEl below) — reuses ask() so clicking one behaves exactly like
    // a customer calling PapervineAssistant.ask(question) themselves.
    var suggestionsEl = null;
    if (opts.starterQuestions && opts.starterQuestions.length) {
      var pills = opts.starterQuestions.slice(0, 3).map(function (q) {
        var pill = el("button", { class: "pv-suggestion", type: "button" }, [text(q)]);
        pill.addEventListener("click", function () {
          askFn(q);
        });
        return pill;
      });
      suggestionsEl = el(
        "div",
        { class: "pv-suggestions" },
        [el("div", { class: "pv-suggestions-heading" }, [text(opts.suggestions || "Suggestions")])].concat(
          pills,
        ),
      );
      messagesEl.appendChild(suggestionsEl);
    }

    panelChildren.push(messagesEl, el("div", { class: "pv-inputrow" }, [inputEl, sendEl]));

    var panelClass = "pv-panel";
    if (variant === "modal") panelClass += " pv-variant-modal";
    else if (variant === "panel") panelClass += " pv-variant-panel";
    var panel = el("div", { class: panelClass }, panelChildren);
    // side/align only apply to the default "widget" variant — modal/panel use their own
    // fixed positioning (centered / docked full-height) regardless of side/align.
    if (variant === "widget") {
      panel.style.cssText = edgePositionCss(opts.side, opts.align, 88);
    } else if (variant === "panel" && (opts.side === "left" || opts.side === "inline-start")) {
      // The base .pv-variant-panel rule docks right by default; only the left/right
      // axis of opts.side is honored here — a full-height panel docked to the TOP or
      // BOTTOM edge isn't a pattern worth building out for.
      panel.style.cssText = "left: 0; right: auto; border-width: 0 1px 0 0;";
    }

    var backdrop = variant === "modal" ? el("div", { class: "pv-backdrop" }) : null;

    var launcherChildren = [];
    if (opts.logo) {
      var logoSrc =
        typeof opts.logo === "string" ? opts.logo : opts.logo[theme] || opts.logo.dark || opts.logo.light;
      launcherChildren.push(el("img", { src: safeHref(logoSrc), alt: "" }));
    } else {
      launcherChildren.push(text("💬"));
    }
    // opts.trigger, if given, makes the launcher a pill with a text label instead of
    // the bare icon circle.
    var launcherClass = "pv-launcher";
    if (opts.trigger) {
      launcherClass += " pv-launcher-text";
      launcherChildren.push(text(opts.trigger));
    }
    var launcher = el(
      "button",
      { class: launcherClass, "aria-label": opts.trigger || "Ask the docs assistant" },
      launcherChildren,
    );
    launcher.style.cssText = edgePositionCss(opts.side, opts.align, 20);

    if (backdrop) root.appendChild(backdrop);
    root.appendChild(panel);
    root.appendChild(launcher);

    function openPanel(options) {
      options = options || {};
      panel.classList.add("open");
      if (backdrop) backdrop.classList.add("open");
      if (options.focus !== false) inputEl.focus();
      fireEvent(opts, "open", { source: options.source });
    }
    function closePanel() {
      panel.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
      fireEvent(opts, "close", {});
    }

    launcher.addEventListener("click", function () {
      if (panel.classList.contains("open")) closePanel();
      else openPanel({ source: "launcher" });
    });
    closeEl.addEventListener("click", closePanel);
    if (backdrop) backdrop.addEventListener("click", closePanel);

    // opts.dismissOnInteractOutside: close on a click outside the widget's own host.
    // Attached on the real document, not this shadow root, since the host page is what
    // the visitor actually clicks around in. Events crossing the shadow boundary are
    // retargeted for outside listeners, so e.target here is just the host element
    // itself when the click originated anywhere inside our own UI — host.contains(e.target)
    // still correctly recognizes that case (a node contains itself).
    function outsideClickHandler(e) {
      if (!opts.dismissOnInteractOutside) return;
      if (!panel.classList.contains("open")) return;
      if (host.contains(e.target)) return;
      closePanel();
    }
    document.addEventListener("click", outsideClickHandler, true);

    if (opts.defaultOpen) openPanel({ source: "init", focus: false });

    function addBubble(cls) {
      var bubble = el("div", { class: "pv-msg " + cls });
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return bubble;
    }

    async function send(value) {
      value = (value != null ? value : inputEl.value).trim();
      if (!value) return;
      inputEl.value = "";
      sendEl.disabled = true;
      if (suggestionsEl) {
        suggestionsEl.remove();
        suggestionsEl = null;
      }

      messages.push({ role: "user", parts: [{ type: "text", text: value }] });
      addBubble("user").appendChild(el("span", null, [text(value)]));
      var answerBubble = addBubble("assistant");
      fireEvent(opts, "ask", {});

      // The model streams one text segment per agentic step, narrating between tool
      // calls as well as giving the real final answer ("let me check the intro page…"
      // is a SEPARATE segment from the actual answer that follows it). Only the
      // CURRENT segment is shown — reset on every text-start — so the bubble ends up
      // showing just the final synthesized answer, not a run-on of every step's prose.
      var segment = "";
      var segmentHasText = false;
      var meta = {};

      try {
        await streamEvents(widgetId, messages, function (event) {
          if (event.type === "start-step") {
            segmentHasText = false;
          } else if (event.type === "tool-input-start" && !segmentHasText) {
            while (answerBubble.firstChild) answerBubble.removeChild(answerBubble.firstChild);
            answerBubble.appendChild(el("em", null, [text("Searching the docs…")]));
          } else if (event.type === "text-start") {
            segment = "";
          } else if (event.type === "text-delta" && event.delta) {
            segment += event.delta;
            segmentHasText = true;
            renderMarkdownInto(answerBubble, segment, meta.docsBase);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }, meta);
        messages.push({ role: "assistant", parts: [{ type: "text", text: segment }] });
        upgradeMermaidDiagrams(answerBubble, theme);
      } catch (err) {
        answerBubble.classList.remove("assistant");
        answerBubble.classList.add("error");
        while (answerBubble.firstChild) answerBubble.removeChild(answerBubble.firstChild);
        answerBubble.appendChild(text(err && err.message ? err.message : "Something went wrong."));
        fireError(opts, { code: "request_failed", retryable: true, message: err && err.message });
      } finally {
        sendEl.disabled = false;
      }
    }

    function askFn(question, options) {
      options = options || {};
      if (options.open !== false) openPanel({ source: "ask", focus: options.focus });
      send(question);
    }

    sendEl.addEventListener("click", function () {
      send();
    });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    fireEvent(opts, "init", {});

    return {
      open: openPanel,
      close: closePanel,
      ask: askFn,
      reset: function () {
        messages = [];
        while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
        suggestionsEl = null;
        fireEvent(opts, "reset", {});
      },
      // Updates settings live without clearing the conversation — covers the options
      // that can sensibly change on an already-mounted instance (theme, text labels,
      // the accent/radius/font/zIndex CSS vars). Structural options (variant, side/
      // align, logo, trigger) are simplest to change via destroy() + a fresh init().
      update: function (config) {
        for (var k in config) opts[k] = config[k];
        if (config.theme !== undefined) {
          theme = resolveTheme(opts.theme);
          host.classList.toggle("pv-theme-light", theme === "light");
        }
        if (config.title !== undefined) titleEl.textContent = opts.title || "Ask the docs assistant";
        if (config.placeholder !== undefined) {
          inputEl.setAttribute("placeholder", opts.placeholder || "Ask a question…");
        }
        if (config.accent !== undefined) {
          host.style.setProperty("--pv-accent", opts.accent);
          host.style.setProperty("--pv-link", opts.accent);
        }
        if (config.radius !== undefined) host.style.setProperty("--pv-radius", opts.radius);
        if (config.font !== undefined) host.style.setProperty("--pv-font", opts.font);
        if (config.zIndex !== undefined) host.style.setProperty("--pv-zindex", opts.zIndex);
        fireEvent(opts, "update", {});
      },
      destroy: function () {
        document.removeEventListener("click", outsideClickHandler, true);
        host.remove();
        fireEvent(opts, "destroy", {});
      },
    };
  }

  // The single mounted widget's controller (mount()'s return value) — null until init()
  // resolves. The bare window.PapervineAssistant.open/close/ask/... convenience methods
  // below delegate to it, matching hosted docs platforms' own flat-namespace API rather
  // than requiring every caller to hold onto init()'s resolved value.
  var instance = null;

  // A page that combines the single-tag data-widget-id install with a second manual
  // init() call (a plausible copy-paste mistake — the docs show both as alternatives,
  // not as something to combine) would otherwise mount two separate bubbles. init() is
  // idempotent instead: the first call wins, every later call resolves to the SAME
  // instance rather than mounting a second one. destroy() clears \`instance\`, so a
  // subsequent init() call is free to mount again.
  window.PapervineAssistant = {
    init: function (opts) {
      if (!opts || !opts.id) throw new Error("PapervineAssistant.init requires { id }");
      if (instance) return Promise.resolve(instance);
      return new Promise(function (resolve) {
        function doMount() {
          instance = mount(opts);
          resolve(instance);
        }
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", doMount);
        } else {
          doMount();
        }
      });
    },
    // Runtime methods (SPEC §8.7) — operate on whatever instance is currently mounted;
    // a no-op before init() resolves or after destroy(), rather than throwing, since a
    // customer's own code calling these opportunistically (e.g. from a page-wide
    // keyboard shortcut) shouldn't need to guard every call itself.
    open: function (options) {
      if (instance) instance.open(options);
    },
    close: function () {
      if (instance) instance.close();
    },
    ask: function (question, options) {
      if (instance) instance.ask(question, options);
    },
    update: function (config) {
      if (instance) instance.update(config);
    },
    reset: function () {
      if (instance) instance.reset();
    },
    destroy: function () {
      if (instance) {
        instance.destroy();
        instance = null;
      }
    },
    // A small, safe (DOM-based, no innerHTML) markdown-to-HTML utility, exposed for
    // deterministic testing and for anyone building a custom UI against the widget's
    // rendering rules. Renders into a detached element and returns its HTML.
    renderMarkdownHTML: function (markdown, base) {
      var container = document.createElement("div");
      renderMarkdownInto(container, markdown, base);
      return container.innerHTML;
    },
    // Triggers the on-demand mermaid upgrade for any .pv-mermaid fallback already
    // rendered inside "container" (e.g. via renderMarkdownHTML) — exposed alongside it
    // for the same reason: deterministic testing without a live model call, and for a
    // custom UI that wants the same on-demand diagram rendering this widget uses.
    // Returns a promise that settles once every diagram has upgraded or fallen back.
    upgradeMermaidDiagrams: upgradeMermaidDiagrams,
  };

  // Alternative single-tag install: a data-widget-id attribute on the loader script itself
  // auto-initializes, so a site that just wants the default bubble doesn't need a second
  // inline <script type="module"> block. document.currentScript is always null for module
  // scripts (spec, not a bug) — find the tag by its own src instead. It's already in the
  // DOM by the time this module body runs, since it's the very tag executing it.
  var autoScript = document.querySelector('script[src*="/api/widget/embed.js"][data-widget-id]');
  if (autoScript) {
    window.PapervineAssistant.init({ id: autoScript.getAttribute("data-widget-id") });
  }
})();
`;
