// Automation model eval (CLI) — runs each model through the real agent loop (read + edit
// tools) over a fixture corpus with planted errors, then scores accuracy, over-editing, and
// code safety. NOT a CI test: it calls real, paid, non-deterministic models and needs
// AI_GATEWAY_API_KEY. Run it on demand when choosing or vetting an automations model.
//
//   npm run eval                              # all models × all tasks, human table
//   npm run eval -- --models=a,b --task=grammar-typos
//   npm run eval -- --runs=3                  # repeat each model (non-determinism → average)
//   npm run --silent eval -- --json           # machine-readable (for an agent to parse)
//
// A browser version with live diffs: `npm run eval:web` (evals/serve.mjs). Shared run/score
// logic lives in evals/core.mjs. See evals/README.md.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MODELS } from "./models.mjs";
import { TASKS } from "./tasks.mjs";
import { loadCorpus, runOnce, aggregate, sortBoard, hasGatewayAuth } from "./core.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), ".out");
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

if (!hasGatewayAuth()) {
  console.error(
    "AI_GATEWAY_API_KEY is not set. Run with:  node --env-file=.env.local evals/run.mjs\n" +
      "(the `npm run eval` script does this for you).",
  );
  process.exit(1);
}
const log = (...a) => !JSON_OUT && console.log(...a);

// ---- run ----
const all = [];
for (const task of TASKS.filter((t) => taskIds.includes(t.id))) {
  const original = loadCorpus(task);
  log(`\n### task: ${task.id} — ${task.title}  (${task.planted.length} planted errors)`);
  for (const slug of modelSlugs) {
    for (let run = 1; run <= RUNS; run++) {
      process.stderr.write(`running ${slug} — ${task.id} (${run}/${RUNS})\n`);
      const r = await runOnce(task, slug, original, { outDir: OUT });
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

// ---- leaderboard ----
const board = sortBoard(modelSlugs.map((s) => aggregate(s, all)));

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
