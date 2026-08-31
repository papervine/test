# CLI

`papervine` runs inside a folder of MDX + a `docs.json` and serves that folder with the same
renderer that powers hosted Papervine sites — so a local preview is what ships.

It is a **production build**, not a development server: no dev-mode compile step and no hot
reload. Requires Node 20.9 or newer.

```bash
npx papervine new my-docs  # create a site from the starter template
npx papervine dev          # preview ./ (must contain docs.json)
npx papervine dev ./docs   # preview a subfolder
npx papervine dev -p 4000  # preview on a specific port
papervine serve ./docs     # serve it for real (binds 0.0.0.0)
```

## Three commands, and that's the surface

| Command | What it does |
| --- | --- |
| `papervine new [dir]` | Scaffold a complete working site — `docs.json`, pages, a component gallery, an OpenAPI example. Refuses a non-empty directory unless `--force`; a directory holding only dotfiles counts as empty. The template ships inside the package, so it works offline. |
| `papervine dev [dir]` | Preview. Binds loopback. Offers to scaffold when there is no `docs.json` (interactive terminals only). |
| `papervine serve [dir]` | The same server with production defaults: binds every interface, never scaffolds. |

**There is no `deploy` and no `login`** — the CLI is a previewer, not a deployer. Publishing
happens through Git (push the repo) and the hosted control plane.

**These commands do not exist**, and suggesting one is a common mistake: `validate`,
`broken-links`, `openapi-check`, `a11y`, `score`, `automations`, `analytics`, `format`,
`config`, `index`, `signup`, `build`. Some are on the roadmap; none are shipped.

## Options

| Flag | Applies to | Description | Default |
| --- | --- | --- | --- |
| `-p, --port <port>` | `dev`, `serve` | Port to serve on | `3000` |
| `--host <addr>` | `dev`, `serve` | Bind address | `127.0.0.1` for `dev`, `0.0.0.0` for `serve` |
| `-y, --yes` | `dev` | Scaffold a starter site if there are no docs, without asking | — |
| `-f, --force` | `new` | Scaffold into a directory that isn't empty | — |
| `-h, --help` | all | Show help | — |
| `-v, --version` | — | Print the installed version | — |

Without `--port`, a busy port is skipped and the next free one is used. **With** an explicit
`--port`, a busy port is an error — an explicit request shouldn't be quietly redirected.

`PAPERVINE_HOST` is equivalent to `--host`. (Not `HOSTNAME`: Docker sets that to the container
id and Kubernetes to the pod name.)

`NO_COLOR` disables color output; `FORCE_COLOR` keeps it through a pipe. `NO_COLOR` wins when
both are set. Output is plain automatically when not attached to a terminal.

## Editing loop

Pages render per request and read from disk each time, so **saving a file and refreshing the
browser shows the change**. There is no hot reload — a refresh is the update.

That is a consequence of shipping the renderer prebuilt: nothing compiles on your machine, so
there is no toolchain to install and no first-run compile, and the preview starts serving in
about a second.

Because the stylesheet is compiled when the package is built, arbitrary Tailwind utilities
written in MDX may not be in it. Use the built-in components and `docs.json` theming.

## What's included

The CLI is the **renderer**: MDX compilation, `docs.json` parsing, navigation, the component
set, OpenAPI endpoint pages, search, the AI assistant, and an `/mcp` server.

It carries **none** of the hosted control plane — no authentication, database, object storage,
or realtime. Concretely, a self-hosted site has one site per process, no CDN or caching layer,
**no reader authentication**, and no analytics.

That last point matters when a repo has gated pages: with no reader auth, the CLI applies no
gate. `list_pages` returns every page and `read_page` will read one marked `groups: [...]`. On a
hosted site the same tools see only the public subset.

## Images

Images are optimized on the fly — resized to what the page needs and served as WebP where
accepted. That work is done by `sharp`, an **optional dependency** (it carries a compiled binary
specific to the OS and CPU). If it can't be installed, the CLI still runs and serves images at
original size, and says so at startup:

```
! image optimization unavailable — serving images at original size.
  Install the optional dependency with `npm i sharp` in this project.
```

Worth acting on for a site serving real readers — it is the difference between a page sending a
few KB of images and a few hundred.

## AI assistant

The assistant appears in the navbar once a model is configured, and is absent when one isn't.
Nothing to enable; the SDKs ship with the CLI. **The model id and the routing always travel
together:**

```bash
# Claude
AI_ROUTING=direct
PAPERVINE_AI_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# Free and offline (Ollama)
PAPERVINE_AI_MODEL=ollama/qwen3.5
```

Put them in the docs project's `.env.local` (the CLI loads it) or export them before running.

A provider key on its own does nothing: `AI_ROUTING` defaults to `gateway`, so exporting
`ANTHROPIC_API_KEY` alone leaves the assistant hidden while it looks for a gateway key. Set the
model *and* the routing.

Usage is billed by whoever provides the model. The CLI meters nothing and reports nothing
anywhere — it carries no database and no telemetry.

## Serving in production

Because the CLI runs a production build of the same renderer, serving your own docs from it is
supported rather than a workaround. Four things change:

**Use `serve`.** It binds every interface. `dev` stays on loopback, which is right for a laptop
and wrong for a server.

```bash
papervine serve ./docs --port 3000
```

**Terminate TLS in front of it.** The CLI serves plain HTTP and does no `Host` routing — put
nginx, Caddy, or a load balancer in front. Pinning `serve` back to `127.0.0.1` with `--host` is
the right move behind a reverse proxy.

**Publish by replacing files.** Pages read from disk per request, so writing new MDX into the
served directory updates the site — no rebuild, no restart. MDX compilation and highlighting are
cached, and the search index is fingerprinted by content.

**Crawlers get a permissive answer.** `/robots.txt` responds `User-Agent: *` / `Allow: /` and
nothing else; `/sitemap.xml` answers with a valid but empty document. Add stricter rules in
front of the process if you need them.

## Trust model

`papervine dev` **compiles** the repo's MDX on your machine but does not *execute* the repo's
code there. Anything a page computes — an expression, an author-defined component, a hook — runs
in your **browser**. What the server renders is Markdown, the built-in components, and literal
values.

So a docs page can't read your environment variables, touch your filesystem, or run commands.
It is still someone else's JavaScript running in your browser on the preview's origin, which is
the same trust you extend to any site you visit.

The surface is narrow by construction: loopback by default, only asset file types served out of
the content directory, remote image URLs refused. The one thing that talks to the network is the
assistant, and only once a model is configured and asked something.

## Troubleshooting

**`no docs.json in <dir>`** — the CLI needs a `docs.json` at the root of the folder you point
it at. Docs usually live in a subdirectory: `papervine dev ./docs`.

**`port 3000 is already in use`** — you passed an explicit `--port` that's taken. Choose
another, or drop the flag and let the CLI pick the next free port.

**A component renders as plain text** — unknown components degrade to their children by design.
Check the name against `components.md`.

**A page shows an inline notice instead of content** — the MDX didn't compile, or an
author-defined component broke the contract (see `components.md`). `papervine dev` shows the
underlying error.
