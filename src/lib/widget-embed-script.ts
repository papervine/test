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
  // crafted "javascript:" markdown link must never become a real href.
  function safeHref(url) {
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.charAt(0) === "/" || url.charAt(0) === "#") return url;
    return "#";
  }

  // Hand-rolled inline markdown (bold/italic/code/links) — returns an array of DOM nodes,
  // never a raw HTML string. No regex: character-by-character scanning avoids the
  // escaping pitfalls of embedding backslash/backtick-heavy regex literals inside this
  // already-templated script, and is easy to reason about directly.
  function renderInlineNodes(s) {
    var nodes = [];
    var i = 0;
    while (i < s.length) {
      if (s.slice(i, i + 2) === "**") {
        var boldEnd = s.indexOf("**", i + 2);
        if (boldEnd !== -1) {
          nodes.push(el("strong", null, renderInlineNodes(s.slice(i + 2, boldEnd))));
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
      if (s.charAt(i) === "[") {
        var closeBracket = s.indexOf("]", i + 1);
        if (closeBracket !== -1 && s.charAt(closeBracket + 1) === "(") {
          var closeParen = s.indexOf(")", closeBracket + 2);
          if (closeParen !== -1) {
            var label = s.slice(i + 1, closeBracket);
            var url = s.slice(closeBracket + 2, closeParen);
            nodes.push(
              el("a", { href: safeHref(url), target: "_blank", rel: "noreferrer" }, [text(label)]),
            );
            i = closeParen + 1;
            continue;
          }
        }
      }
      if (s.charAt(i) === "*" && s.charAt(i + 1) !== "*") {
        var italicEnd = s.indexOf("*", i + 1);
        if (italicEnd !== -1) {
          nodes.push(el("em", null, renderInlineNodes(s.slice(i + 1, italicEnd))));
          i = italicEnd + 1;
          continue;
        }
      }
      var start = i;
      while (i < s.length && s.charAt(i) !== "*" && s.charAt(i) !== "\`" && s.charAt(i) !== "[") i++;
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

  // Block-level markdown (headings, lists, fenced code, tables, paragraphs) — appends
  // real DOM nodes into \`container\` (clearing it first). Same no-innerHTML, no-regex
  // reasoning as renderInlineNodes above.
  function renderMarkdownInto(container, raw) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var lines = raw.split("\\n");
    var i = 0;
    var para = [];
    var list = null;

    function flushPara() {
      if (para.length) {
        container.appendChild(el("p", null, renderInlineNodes(para.join(" "))));
        para = [];
      }
    }
    function flushList() {
      if (list) {
        var items = list.items.map(function (it) {
          return el("li", null, renderInlineNodes(it));
        });
        container.appendChild(el(list.tag, null, items));
        list = null;
      }
    }

    while (i < lines.length) {
      var line = lines[i];

      if (line.slice(0, 3) === "\`\`\`") {
        flushPara();
        flushList();
        var code = [];
        i++;
        while (i < lines.length && lines[i].slice(0, 3) !== "\`\`\`") {
          code.push(lines[i]);
          i++;
        }
        i++;
        container.appendChild(el("pre", null, [el("code", null, [text(code.join("\\n"))])]));
        continue;
      }

      if (line.indexOf("|") !== -1 && i + 1 < lines.length) {
        var headerCells = splitTableRow(line);
        var sepCells = splitTableRow(lines[i + 1]);
        if (headerCells.length > 0 && isSeparatorRow(sepCells)) {
          flushPara();
          flushList();
          var thead = el(
            "thead",
            null,
            [el("tr", null, headerCells.map(function (c) { return el("th", null, renderInlineNodes(c)); }))],
          );
          var bodyRows = [];
          i += 2;
          while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") {
            var rowCells = splitTableRow(lines[i]);
            bodyRows.push(
              el("tr", null, rowCells.map(function (c) { return el("td", null, renderInlineNodes(c)); })),
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
        flushList();
        container.appendChild(el("h" + level, null, renderInlineNodes(line.slice(level + 1))));
        i++;
        continue;
      }

      if ((line.charAt(0) === "-" || line.charAt(0) === "*") && line.charAt(1) === " ") {
        flushPara();
        if (!list || list.tag !== "ul") {
          flushList();
          list = { tag: "ul", items: [] };
        }
        list.items.push(line.slice(2));
        i++;
        continue;
      }

      var digits = 0;
      while (digits < line.length && line.charAt(digits) >= "0" && line.charAt(digits) <= "9") digits++;
      if (digits > 0 && line.slice(digits, digits + 2) === ". ") {
        flushPara();
        if (!list || list.tag !== "ol") {
          flushList();
          list = { tag: "ol", items: [] };
        }
        list.items.push(line.slice(digits + 2));
        i++;
        continue;
      }

      if (line.trim() === "") {
        flushPara();
        flushList();
        i++;
        continue;
      }

      flushList();
      para.push(line);
      i++;
    }
    flushPara();
    flushList();
  }

  var STYLE = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }",
    ".pv-launcher { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px;",
    "  border-radius: 50%; background: #111; color: #fff; border: none; cursor: pointer;",
    "  box-shadow: 0 4px 16px rgba(0,0,0,0.25); font-size: 24px; z-index: 2147483000; }",
    ".pv-panel { position: fixed; bottom: 88px; right: 20px; width: 360px; max-width: calc(100vw - 40px);",
    "  height: 480px; max-height: calc(100vh - 120px); background: #fff; border-radius: 16px;",
    "  box-shadow: 0 8px 32px rgba(0,0,0,0.28); display: none; flex-direction: column; overflow: hidden;",
    "  z-index: 2147483000; border: 1px solid rgba(0,0,0,0.08); }",
    ".pv-panel.open { display: flex; }",
    ".pv-header { padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,0.08); font-size: 14px; font-weight: 600; }",
    ".pv-messages { flex: 1; overflow-y: auto; padding: 12px 14px; font-size: 14px; line-height: 1.5; }",
    ".pv-msg { margin-bottom: 12px; word-break: break-word; }",
    ".pv-msg.user { text-align: right; color: #111; white-space: pre-wrap; }",
    ".pv-msg.assistant { text-align: left; color: #333; }",
    ".pv-msg.error { color: #b91c1c; white-space: pre-wrap; }",
    ".pv-msg p { margin: 0 0 8px; }",
    ".pv-msg p:last-child { margin-bottom: 0; }",
    ".pv-msg h1, .pv-msg h2, .pv-msg h3, .pv-msg h4, .pv-msg h5, .pv-msg h6 { margin: 12px 0 6px; font-weight: 600; line-height: 1.3; }",
    ".pv-msg h1 { font-size: 17px; } .pv-msg h2 { font-size: 15.5px; } .pv-msg h3, .pv-msg h4, .pv-msg h5, .pv-msg h6 { font-size: 14px; }",
    ".pv-msg ul, .pv-msg ol { margin: 6px 0; padding-left: 20px; }",
    ".pv-msg li { margin: 2px 0; }",
    ".pv-msg code { background: rgba(0,0,0,0.06); border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }",
    ".pv-msg pre { background: rgba(0,0,0,0.04); border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }",
    ".pv-msg pre code { background: none; padding: 0; }",
    ".pv-msg table { border-collapse: collapse; margin: 8px 0; width: 100%; font-size: 12.5px; }",
    ".pv-msg th, .pv-msg td { border: 1px solid rgba(0,0,0,0.12); padding: 4px 8px; text-align: left; vertical-align: top; }",
    ".pv-msg th { background: rgba(0,0,0,0.04); font-weight: 600; }",
    ".pv-msg a { color: #2563eb; text-decoration: underline; }",
    ".pv-msg em { font-style: italic; }",
    ".pv-inputrow { display: flex; gap: 8px; padding: 10px; border-top: 1px solid rgba(0,0,0,0.08); }",
    ".pv-input { flex: 1; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; padding: 8px 10px; font-size: 14px; outline: none; }",
    ".pv-send { border: none; background: #111; color: #fff; border-radius: 8px; padding: 0 14px; font-size: 14px; cursor: pointer; }",
    ".pv-send:disabled { opacity: 0.5; cursor: default; }",
  ].join("\\n");

  // Yields every parsed SSE event on the wire (not just text-delta) so the caller can tell
  // segment boundaries (text-start/text-end) and tool-call activity (start-step,
  // tool-input-start) apart from the running answer text.
  async function streamEvents(widgetId, messages, onEvent) {
    var res = await fetch(API_BASE + "/api/widget/" + widgetId + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messages }),
    });
    if (!res.ok) {
      var body = await res.json().catch(function () { return {}; });
      throw new Error(body.error || ("Request failed (" + res.status + ")"));
    }
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

  function mount(opts) {
    var widgetId = opts.id;
    var messages = [];

    var host = el("div");
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", null, [text(STYLE)]));

    var messagesEl = el("div", { class: "pv-messages" });
    var inputEl = el("input", { class: "pv-input", placeholder: "Ask a question…" });
    var sendEl = el("button", { class: "pv-send" }, [text("Send")]);
    var panel = el("div", { class: "pv-panel" }, [
      el("div", { class: "pv-header" }, [text("Ask the docs assistant")]),
      messagesEl,
      el("div", { class: "pv-inputrow" }, [inputEl, sendEl]),
    ]);
    var launcher = el("button", { class: "pv-launcher" }, [text("💬")]);
    root.appendChild(panel);
    root.appendChild(launcher);

    launcher.addEventListener("click", function () {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) inputEl.focus();
    });

    function addBubble(cls) {
      var bubble = el("div", { class: "pv-msg " + cls });
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return bubble;
    }

    async function send() {
      var value = inputEl.value.trim();
      if (!value) return;
      inputEl.value = "";
      sendEl.disabled = true;

      messages.push({ role: "user", parts: [{ type: "text", text: value }] });
      addBubble("user").appendChild(text(value));
      var answerBubble = addBubble("assistant");

      // The model streams one text segment per agentic step, narrating between tool
      // calls as well as giving the real final answer ("let me check the intro page…"
      // is a SEPARATE segment from the actual answer that follows it). Only the
      // CURRENT segment is shown — reset on every text-start — so the bubble ends up
      // showing just the final synthesized answer, not a run-on of every step's prose.
      var segment = "";
      var segmentHasText = false;

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
            renderMarkdownInto(answerBubble, segment);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        });
        messages.push({ role: "assistant", parts: [{ type: "text", text: segment }] });
      } catch (err) {
        answerBubble.classList.remove("assistant");
        answerBubble.classList.add("error");
        while (answerBubble.firstChild) answerBubble.removeChild(answerBubble.firstChild);
        answerBubble.appendChild(text(err && err.message ? err.message : "Something went wrong."));
      } finally {
        sendEl.disabled = false;
      }
    }

    sendEl.addEventListener("click", send);
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });
  }

  window.PapervineAssistant = {
    init: function (opts) {
      if (!opts || !opts.id) throw new Error("PapervineAssistant.init requires { id }");
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { mount(opts); });
      } else {
        mount(opts);
      }
    },
    // A small, safe (DOM-based, no innerHTML) markdown-to-HTML utility, exposed for
    // deterministic testing and for anyone building a custom UI against the widget's
    // rendering rules. Renders into a detached element and returns its HTML.
    renderMarkdownHTML: function (markdown) {
      var container = document.createElement("div");
      renderMarkdownInto(container, markdown);
      return container.innerHTML;
    },
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
