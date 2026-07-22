// Shared eval core — the agent loop + scoring, used by BOTH the CLI (run.mjs) and the web
// server (serve.mjs) so there's one source of truth for how a model is run and scored.
// No CLI/HTTP concerns here; callers own I/O and presentation.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateText, stepCountIs, tool, gateway } from "ai";
import { z } from "zod";
import { priceFor } from "./models.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Load a task's fixture corpus as { filename: text }. */
export function loadCorpus(task) {
  const dir = join(HERE, "corpus", task.corpus);
  const files = readdirSync(dir).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
}

/** The read/edit tools the agent gets. Mutates `work` in place; records every edit. */
export function makeTools(work, edits) {
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

/** Score final content vs the task's ground truth. */
export function score(task, original, work) {
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

/** Classify recorded edits: `extra` = applied edits not targeting a planted error
 *  (over-editing); `failed` = edits whose `find` text wasn't present verbatim. */
export function classifyEdits(task, edits) {
  const bads = task.planted.map(([, bad]) => bad);
  const extra = edits.filter(
    (e) => e.applied && !bads.some((b) => e.find.includes(b) || b.includes(e.find.trim())),
  );
  const failed = edits.filter((e) => !e.applied);
  return { extra: extra.length, failed: failed.length };
}

/** Run one model once against a task's corpus and return the scored result.
 *  Pass `outDir` to also persist the edited files (CLI does; the web UI omits it and
 *  renders diffs from the returned `edits` instead). */
export async function runOnce(task, slug, original, { outDir } = {}) {
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
  if (outDir)
    for (const f of Object.keys(work))
      writeFileSync(join(outDir, `${task.id}__${slug.replace(/\//g, "_")}__${f}`), work[f]);
  return { slug, task: task.id, secs, steps, tin, tout, cost, ...sc, ...cls, edits, summary: text, err };
}

/** Aggregate one model's runs (averaged) into a leaderboard row. */
export function aggregate(slug, all) {
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

/** Sort leaderboard rows: accuracy, then fewest over-edits, then cost. */
export function sortBoard(rows) {
  return rows
    .filter(Boolean)
    .sort((a, b) => b.fixed - a.fixed || a.over - b.over || (a.cost ?? 9) - (b.cost ?? 9));
}

/** True when the gateway can be reached (key present). Callers guard on this. */
export function hasGatewayAuth() {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}
