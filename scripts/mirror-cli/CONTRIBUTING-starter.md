# Contributing

Thanks for being here. Two things are worth knowing before you spend time on a change.

## You probably want to fork, not contribute

This repo is a **starter template**. If you're here to build your own docs site, fork it (or
copy the files) and edit freely — you don't need permission and there's nothing to send back.

```bash
git clone https://github.com/papervine/starter my-docs
cd my-docs
npx papervine@latest dev
```

Everything renders locally with no services and no build step.

## If you're improving the template itself

Pull requests are welcome, with one unusual wrinkle:

> **PRs are reviewed here, but merged upstream.** Nobody clicks "Merge" on this repository — a
> merge here would be reverted by the next sync. Instead an accepted PR is applied to the
> Papervine monorepo, and the next sync carries it back out.

This repo is a **generated mirror**. The files live in the monorepo as `examples/starter`,
because Papervine's own test setup builds from them — including the reader-auth test bed under
`internal/`, whose `groups:` frontmatter exercises per-page access control. Keeping them there
means a change to this template and the code that renders it can land together, and can't drift
apart.

**Your commit authorship is preserved.** When your change is applied upstream it keeps you as
the author, so the commit that lands here is credited to you and counts toward your GitHub
contribution graph. When we close your PR we'll link the commit.

We know a closed PR reads worse than a merged one. It's the honest trade for keeping this
template versioned alongside the tests that depend on it.

## What makes a good change

- **Show a component, don't describe it.** `components/` is a gallery — one page per component,
  each showing the thing rendered and then the exact source underneath.
- **Keep the example and its snippet identical.** Every component page renders an example and
  repeats it in a fenced block for copying. If you change one, change the other: a snippet that
  doesn't produce the example above it is worse than no snippet.
- **Keep it renderable.** Run `npx papervine@latest dev` and check the page before opening a
  PR. A template with a broken page is worse than a thin one.
- **Every page needs to be in `docs.json`.** A page that isn't in the navigation still renders
  at its URL, but nobody will find it.
- **Don't add heavy assets.** This is something people clone; keep images small and prefer SVG.

## Reporting a problem

If a page renders wrong, the most useful report is the page plus what you expected — or a
minimal `docs.json` and `.mdx` pair that reproduces it. That usually becomes a regression test
directly.

For a bug in the renderer itself rather than this content, open it against
[papervine/papervine](https://github.com/papervine/papervine).
