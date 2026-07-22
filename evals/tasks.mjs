// Eval tasks. Each task is a fixture corpus + a ground truth, run against every model.
//
// A task's `system`/`prompt` mirror what the real automation sends (see
// src/trigger/automation-run.ts for the SYSTEM shape and src/lib/automations/catalog for the
// per-automation prompts) — kept here as plain strings so the eval stays a dependency-light
// .mjs. If you change the real automation prompt and want the eval to track it, update here too.
//
// Ground truth:
//   planted   [file, bad, good]  — "fixed" iff the final file drops `bad` and contains `good`
//                                  (good may be an array of acceptable corrections).
//   protected [substring]        — MUST survive untouched (code, commands, config values,
//                                  technical terms). A model that changes one over-reached.
//
// To add a task: drop a corpus under evals/corpus/<id>/, then add an entry here.

export const TASKS = [
  {
    id: "grammar-typos",
    title: "Fix grammar & typos",
    corpus: "grammar-typos",
    system:
      "You are running the \"Fix grammar & typos\" automation for a documentation site. " +
      "Work autonomously: read the docs with list_pages and read_page, then fix grammar " +
      "mistakes and typos with edit_page. Make the smallest set of changes that completes " +
      "the task — do not reword for style, and never change code, commands, config values, " +
      "or technical terms. If nothing needs changing, change nothing. When done, reply with " +
      "a one-paragraph summary of exactly what you changed.",
    prompt:
      "Fix all grammar mistakes and typos across the documentation pages. Preserve meaning, " +
      "code blocks, commands, and product/technical terms exactly.",
    planted: [
      ["getting-started.mdx", "lets you to build", "lets you build"],
      ["getting-started.mdx", "Their are three", "There are three"],
      ["getting-started.mdx", "recieve", "receive"],
      ["configuration.mdx", "file configure your", "file configures your"],
      ["configuration.mdx", "Each fields is", ["Each field is", "All fields are"]],
      ["configuration.mdx", "seperate", "separate"],
      ["deployment.mdx", "automaticaly", "automatically"],
      ["deployment.mdx", "manualy", "manually"],
      ["deployment.mdx", "it's own domain", "its own domain"],
    ],
    protected: ["npm run dev", "`docs.json`", '"theme": "mint"', '"name": "Acme Docs"'],
  },
];
