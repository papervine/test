// Automation model eval — runs each model through the real agent loop (read + edit tools)
// over a fixture corpus with planted errors, then scores accuracy, over-editing, and code
// safety. NOT a CI test: it calls real, paid, non-deterministic models and needs
// AI_GATEWAY_API_KEY. Run it on demand when choosing or vetting an automations model.
//
//   npm run eval                              # all models × all tasks, human table
//   npm run eval -- --models=a,b --task=grammar-typos
//   npm run eval -- --runs=3                  # repeat each model (non-determinism → average)
//   npm run eval -- --json > results.json     # machine-readable (for an agent to parse)
//
// See evals/README.md for how to read the output and add tasks/models.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateText, stepCountIs, tool, gateway } from "ai";
import { z } from "zod";
import { MODELS, priceFor } from "./models.mjs";
import { TASKS } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, ".out");
mkdirSync(OUT, { recursive: true });

// ---- args ----
const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const has = (name) => process.argv.includes(`--${name}`);
const JSON_OUT = has("json");
const RUNS = Math.max(1, parseInt(arg("runs", "1"), 10) || 1);
const modelSlugs = (arg("models", "") || "").trim()
  ? arg("models", "").split(",").map((s) => s.trim()).filter(Boolean)
  : MODELS.map((m) => m.slug);
const taskIds = (arg("task", "") || "").trim()
  ? arg("task", "").split(",").map((s) => s.trim())
  : TASKS.map((t) => t.id);

if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.error(
    "AI_GATEWAY_API_KEY is not set. Run with:  node --env-file=.env.local evals/run.mjs\n" +
      "(the `npm run eval` script does this for you).",
  );
  process.exit(1);
}
const log = (...a) => !JSON_OUT && console.log(...a);

// ---- corpus + tools ----
function loadCorpus(task) {
  const dir = join(HERE, "corpus", task.corpus);
  const files = readdirSync(dir).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

function makeTools(work, edits) {
  return {
    list_pages: tool({
      description: "List the documentation page filenames.",
      inputSchema: z.object({}),
      execute: async () => ({ pages: Object.keys(work) }),
    }),
    read_page: tool({
      description: "Read one page's full text.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) =>
        work[path] != null ? { path, content: work[path] } : { error: `no such page: ${path}` },
    }),
    edit_page: tool({
      description:
        "Replace the first occurrence of `find` with `replace` in a page. Use small, exact snippets.",
      inputSchema: z.object({
        path: z.string(),
        find: z.string().describe("Exact text to find (verbatim from the page)."),
        replace: z.string().describe("Replacement text."),
      }),
      execute: async ({ path, find, replace }) => {
        if (work[path] == null) return { error: `no such page: ${path}` };
        const i = work[path].indexOf(find);
        if (i < 0) {
          edits.push({ path, find, replace, applied: false });
          return { error: "find text not found verbatim; re-read the page and copy exactly." };
        }
        work[path] = work[path].slice(0, i) + replace + work[path].slice(i + find.length);
        edits.push({ path, find, replace, applied: true });
        return { ok: true };
      },
    }),
  };
}

// ---- scoring ----
function score(task, original, work) {
  let fixed = 0;
  const missed = [];
  for (const [file, bad, good] of task.planted) {
    const goods = Array.isArray(good) ? good : [good];
    const c = work[file] ?? "";
    if (!c.includes(bad) && goods.some((g) => c.includes(g))) fixed++;
    else missed.push(`${file}: "${bad}"`);
  }
  const brokeProtected = (task.protected ?? []).filter((p) => {
    const inOrig = Object.values(original).some((o) => o.includes(p));
    const inWork = Object.values(work).some((o) => o.includes(p));
    return inOrig && !inWork;
  });
  return { fixed, total: task.planted.length, missed, brokeProtected };
}

function classifyEdits(task, edits) {
  const bads = task.planted.map(([, bad]) => bad);
  const extra = edits.filter(
    (e) => e.applied && !bads.some((b) => e.find.includes(b) || b.includes(e.find.trim())),
  );
  const failed = edits.filter((e) => !e.applied);
  return { extra: extra.length, failed: failed.length };
}

async function runOnce(task, slug, original) {
  const work = { ...original };
  const edits = [];
  const t0 = Date.now();
  let usage = { inputTokens: 0, outputTokens: 0 }, steps = 0, text = "", err = null;
  try {
    const r = await generateText({
      model: gateway(slug),
      system: task.system,
      prompt: task.prompt,
      tools: makeTools(work, edits),
      stopWhen: stepCountIs(24),
      providerOptions: { gateway: { caching: "auto" } }, // mirror prod caching
    });
    usage = r.totalUsage ?? usage;
    steps = r.steps?.length ?? 0;
    text = (r.text || "").trim();
  } catch (e) {
    err = e?.message || String(e);
  }
  const secs = +((Date.now() - t0) / 1000).toFixed(1);
  const sc = score(task, original, work);
  const cls = classifyEdits(task, edits);
  const price = priceFor(slug);
  const tin = usage.inputTokens ?? 0, tout = usage.outputTokens ?? 0;
  const cost = price.in != null ? (tin / 1e6) * price.in + (tout / 1e6) * price.out : null;
  for (const f of Object.keys(work))
    writeFileSync(join(OUT, `${task.id}__${slug.replace(/\//g, "_")}__${f}`), work[f]);
  return { slug, task: task.id, secs, steps, tin, tout, cost, ...sc, ...cls, edits, summary: text, err };
}

// ---- run ----
const all = [];
for (const task of TASKS.filter((t) => taskIds.includes(t.id))) {
  const original = loadCorpus(task);
  log(`\n### task: ${task.id} — ${task.title}  (${task.planted.length} planted errors)`);
  for (const slug of modelSlugs) {
    for (let run = 1; run <= RUNS; run++) {
      process.stderr.write(`running ${slug} — ${task.id} (${run}/${RUNS})\n`);
      const r = await runOnce(task, slug, original);
      r.run = run;
      all.push(r);
      if (JSON_OUT) continue;
      if (r.err) { log(`\n${slug}  ERROR: ${r.err}`); continue; }
      log(`\n${slug}${RUNS > 1 ? `  (run ${run})` : ""}`);
      log(
        `  time ${r.secs}s | steps ${r.steps} | ${r.tin}in/${r.tout}out` +
          (r.cost != null ? ` | ~$${r.cost.toFixed(5)}` : " | cost n/a"),
      );
      log(
        `  fixed ${r.fixed}/${r.total} | over-edits ${r.extra} | find-misses ${r.failed} | broke-code ${r.brokeProtected.length}`,
      );
      if (r.missed.length) log(`  MISSED: ${r.missed.join(" ; ")}`);
      if (r.brokeProtected.length) log(`  ⚠ BROKE PROTECTED: ${r.brokeProtected.join(" ; ")}`);
      for (const e of r.edits)
        log(`    ${e.applied ? "  " : "✗ "}${e.path}: "${e.find.replace(/\n/g, "⏎").slice(0, 70)}" → "${e.replace.replace(/\n/g, "⏎").slice(0, 70)}"`);
    }
  }
}

// ---- leaderboard (averaged over runs) ----
function agg(slug) {
  const rs = all.filter((r) => r.slug === slug && !r.err);
  if (!rs.length) return null;
  const avg = (k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  return {
    slug,
    fixed: +avg("fixed").toFixed(2),
    total: rs[0].total,
    over: +avg("extra").toFixed(2),
    brokeCode: +(rs.reduce((s, r) => s + r.brokeProtected.length, 0) / rs.length).toFixed(2),
    cost: rs[0].cost != null ? +avg("cost").toFixed(5) : null,
    secs: +avg("secs").toFixed(1),
    runs: rs.length,
  };
}
const board = modelSlugs.map(agg).filter(Boolean)
  .sort((a, b) => b.fixed - a.fixed || a.over - b.over || (a.cost ?? 9) - (b.cost ?? 9));

if (JSON_OUT) {
  console.log(JSON.stringify({ runs: RUNS, results: all, leaderboard: board }, null, 2));
} else {
  log(`\n${"═".repeat(78)}\nLEADERBOARD  (accuracy, then fewest over-edits, then cost${RUNS > 1 ? `; avg of ${RUNS} runs` : ""})\n${"═".repeat(78)}`);
  for (const b of board)
    log(
      `  ${b.slug.padEnd(30)} fixed ${b.fixed}/${b.total}  over-edit ${b.over}  broke-code ${b.brokeCode}  ` +
        (b.cost != null ? `~$${b.cost.toFixed(5)}` : "cost n/a") + `  ${b.secs}s`,
    );
  log(`\nfinal edited files: ${OUT}`);
}
