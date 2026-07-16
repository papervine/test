# The Engineering Playbook

Project-agnostic engineering doctrine: how features, bugfixes, and changes get built,
tested, verified, and documented. **Nothing in this folder mentions this repo's stack or
file layout** — it is written to be lifted wholesale into any project (or promoted to its
own repo) without edits.

## How this folder relates to the repo

- **This folder is the doctrine** — the *what* and *why* of the process, reusable anywhere.
- **`AGENTS.md` at the repo root is the binding** — the doctrine mapped onto this repo's
  concrete commands, test layers, file paths, and hard-won gotchas. Agents and humans work
  from the binding; they read the playbook when they need the full reasoning.

A repo's binding must be self-sufficient: someone (or some agent) with only `AGENTS.md`
should be able to work correctly. The playbook is the source the binding distills from,
not a link it hides behind.

## Adopting this playbook in a new project

1. Copy this folder into the repo root.
2. Write the binding (`AGENTS.md` / `CLAUDE.md`): for each chapter, the project-specific
   mapping — what "unit" means here, what the smoke gate is, how to drive a browser, where
   docs live. Include a routing table (see `testing.md`) rewritten in the project's terms.
3. Start the project's own gotcha log (see `gotchas.md`) — empty is fine; it fills itself.

## Chapters

| Chapter | The one-line law |
|---|---|
| [`loop.md`](./loop.md) | Every task runs the same loop: clarify → reproduce → plan tests → loop until green → loop on review until quiet → document. |
| [`testing.md`](./testing.md) | Every change owes tests, routed to the lowest layer that can catch the regression. |
| [`verification.md`](./verification.md) | "Working" means shown working in a real browser with a clean console — not a plausible diff. |
| [`documentation.md`](./documentation.md) | Every change is documented twice: a dated design log (why) and evergreen reference (how). |
| [`gotchas.md`](./gotchas.md) | Lessons that cost real debugging time get written down where they'll be found — once. |
