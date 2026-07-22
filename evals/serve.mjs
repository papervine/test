// Automation model eval — local web UI. A tiny zero-dep server (mirrors the
// tests/smoke.mjs / tests/crawl.mjs http.createServer pattern) that runs candidate models
// server-side (it holds the gateway key via .env.local — the browser never sees it) and
// streams results to a self-contained page over SSE. Run: `npm run eval:web`.
//
// Shared run/score logic lives in evals/core.mjs (same as the CLI). This file is only the
// HTTP + SSE plumbing and the static page.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MODELS } from "./models.mjs";
import { TASKS } from "./tasks.mjs";
import { loadCorpus, runOnce, aggregate, sortBoard, hasGatewayAuth } from "./core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

if (!hasGatewayAuth()) {
  console.error(
    "AI_GATEWAY_API_KEY is not set. Start with:  npm run eval:web\n" +
      "(it loads .env.local; the browser never receives the key).",
  );
  process.exit(1);
}

const PAGE = readFileSync(join(HERE, "web", "index.html"), "utf8");
const sendJSON = (res, obj) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

// Stream a run over Server-Sent Events: one `result` per (model, run) as it finishes, then a
// final `done` with the aggregated leaderboard. The client closes the stream on done/fail so
// EventSource doesn't auto-reconnect and re-run.
async function runSSE(res, params) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const task = TASKS.find((t) => t.id === (params.get("task") || TASKS[0]?.id));
  if (!task) return send("fail", { error: `unknown task` }), res.end();
  const slugs = (params.get("models") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slugs.length) return send("fail", { error: "no models selected" }), res.end();
  const runs = Math.max(1, Math.min(10, parseInt(params.get("runs") || "1", 10) || 1));

  const original = loadCorpus(task);
  const all = [];
  try {
    for (const slug of slugs) {
      for (let run = 1; run <= runs; run++) {
        send("start", { slug, run, runs });
        const r = await runOnce(task, slug, original); // no outDir → render diffs in-browser
        r.run = run;
        all.push(r);
        send("result", r);
      }
    }
    send("done", { leaderboard: sortBoard(slugs.map((s) => aggregate(s, all))), runs });
  } catch (e) {
    send("fail", { error: e?.message || String(e) });
  }
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (url.pathname === "/api/config") {
      return sendJSON(res, {
        models: MODELS,
        tasks: TASKS.map((t) => ({
          id: t.id,
          title: t.title,
          planted: t.planted,
          protected: t.protected ?? [],
        })),
      });
    }
    if (url.pathname === "/api/run") return await runSSE(res, url.searchParams);
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500);
    res.end(String(e?.message || e));
  }
});

// Bind local-only; auto-increment if the port is taken (several worktrees can coexist).
function listen(port, tries = 12) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && tries > 0) listen(port + 1, tries - 1);
    else throw e;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`\n  Model eval web UI  →  http://127.0.0.1:${server.address().port}\n  (Ctrl-C to stop)\n`);
  });
}
listen(4321);
