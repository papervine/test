# Contributing

Thanks for being here. One thing is worth knowing before you spend time on a change.

## PRs are reviewed here, but merged upstream

> Nobody clicks "Merge" on this repository — a merge here would be reverted by the next sync.
> An accepted PR is applied to the Papervine monorepo instead, and the next sync carries it
> back out.

This repo is a **generated mirror**. The files live in the monorepo as `agent-context/`, because
this plugin *documents* the renderer: its component set, its `docs.json` handling, its CLI
flags. Keeping the two in one repository means "add a component, update the skill" is a single
reviewable change, and the reference can't quietly describe a version of Papervine that no
longer exists.

**Your commit authorship is preserved.** When your change is applied upstream it keeps you as
the author, so the commit that lands here is credited to you and counts toward your GitHub
contribution graph. When we close your PR we'll link the commit.

We know a closed PR reads worse than a merged one. It's the honest trade for keeping the
reference versioned alongside the code it describes.

## What makes a good change

- **Correct beats complete.** The whole value of this plugin is that an agent stops guessing. A
  documented behavior that doesn't match the renderer is worse than an undocumented one,
  because it gets acted on with confidence.
- **Verify against a running site.** `npx papervine@latest dev` in a docs folder renders the
  real thing. If you're describing a prop, render it first.
- **Say what doesn't work, too.** The `Fields that do not exist` and `These commands do not
  exist` sections earn their place — they stop an agent inventing a plausible-looking option.
- **Keep the core file short.** `skills/papervine/SKILL.md` loads on every task; the
  `reference/` files load only when the task needs them. New detail belongs in a reference
  file, and the core file should route to it.
- **Every `reference/*.md` must be named in the SKILL.md index**, and every file the index names
  must exist. A file nothing routes to is a file no agent reads, and both directions are
  checked before publishing.

## Reporting a problem

The most useful report is what the agent produced, what Papervine actually does, and which file
said otherwise. That usually turns into a one-line fix.

For a bug in the renderer rather than this reference, open it against
[papervine/papervine](https://github.com/papervine/papervine).
