# Model evals

A benchmark for choosing and vetting the model behind Papervine's **automations** (the
agent that reads docs and writes commits/PRs). It runs each candidate model through the
**real agent loop** — the same read + edit tools an automation uses — over a fixture corpus
with **known planted errors**, then scores three things that actually matter for changes
that ship to Git:

- **fixed** — how many planted errors it corrected (accuracy),
- **over-edit** — changes it made that weren't asked for (a cheap model that reworods or
  "corrects" correct text is a liability on auto-commit),
- **broke-code** — did it touch protected code / commands / config / technical terms.

> **This is not a CI test.** It calls real, paid, **non-deterministic** models over the
> network and needs `AI_GATEWAY_API_KEY`. It is deliberately excluded from `npm test` /
> `test:unit` / CI, which stay offline, free, and deterministic. Run it on demand.

## Run it

```bash
npm run eval                                   # all models × all tasks (uses .env.local for the key)
npm run eval -- --models=deepseek/deepseek-v4-flash,anthropic/claude-haiku-4.5
npm run eval -- --task=grammar-typos
npm run eval -- --runs=3                        # repeat each model, average the scores (models are non-deterministic)
npm run --silent eval -- --json > evals/.out/last.json   # machine-readable, for an agent to parse
```

> For `--json`, use `npm run --silent` (or run `node --env-file=.env.local evals/run.mjs --json`
> directly) so npm's own banner doesn't prefix the JSON.

The final edited files for each (task, model) are written to `evals/.out/` (gitignored) so
you can eyeball the actual diffs, not just the scores.

## Web UI

For a human-friendly version — pick models, click Run, watch results stream in live with
color-coded diffs:

```bash
npm run eval:web        # → http://127.0.0.1:4321  (Ctrl-C to stop)
```

It's a tiny local server (`evals/serve.mjs`): it runs the models **server-side** (holding the
gateway key from `.env.local`) and streams each result to a self-contained page over SSE — the
**browser never receives the key**. The page shows a live leaderboard (✓ clean / ⚠ review) and
per-model cards with a ground-truth checklist (fixed vs. missed) and every edit color-coded:
**green** = planted fix, **amber** = over-edit (not asked for), **struck-through** =
find-not-found. Same run/score logic as the CLI (both import `evals/core.mjs`).

## Reading the leaderboard

Sorted by accuracy, then fewest over-edits, then cost. A model that scores `fixed N/N` with
`over-edit 0` and `broke-code 0` is safe to trust with `Require review`; one that over-edits
or breaks code is a liability even if it's cheap and fixed everything. **One run is a
sample, not a verdict** — use `--runs=3` before committing to a model, and always read the
diffs in `.out/`.

## Add a model

Edit `evals/models.mjs` (slug + list prices for the cost estimate), or just pass
`--models=<slug>` — any Vercel AI Gateway slug works. Refresh prices from
`curl -s https://ai-gateway.vercel.sh/v1/models` (fuller table: `_private/vercel-gateway-models.md`).

## Add a task

1. Drop a fixture corpus under `evals/corpus/<id>/` (`.mdx`/`.md` files).
2. Add a task entry in `evals/tasks.mjs`: the `system`/`prompt` the automation would send,
   plus the ground truth — `planted` `[file, bad, good]` triples and a `protected` list of
   substrings that must survive untouched.

The task `system`/`prompt` mirror the real automation (see `src/trigger/automation-run.ts`
and `src/lib/automations/catalog`); keep them roughly in sync so the eval reflects
production behavior.
