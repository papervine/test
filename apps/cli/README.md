<div align="center">
  <a href="https://papervine.io">
    <h2><b>Papervine CLI</b></h2>
  </a>
  <p>
    Preview a docs repo of MDX + a <code>docs.json</code> on your machine, with the
    same renderer that serves it in production.
  </p>
  <p>

[![npm](https://img.shields.io/npm/v/papervine?logo=npm)](https://www.npmjs.com/package/papervine) [![Website](https://img.shields.io/website?url=https%3A%2F%2Fpapervine.io)](https://papervine.io)

  </p>
</div>

### Quickstart

No docs yet? Create a site and preview it:

```
npx papervine@latest new my-docs
cd my-docs
npx papervine@latest dev
```

Already have a folder of MDX and a `docs.json`? Skip straight to previewing it:

```
npx papervine@latest dev ./docs
```

Requires Node 20.9 or higher. The CLI ships a **prebuilt** renderer, so there's no
toolchain to download and no first-run compile — it starts serving immediately.

### Installation

Running through `npx` needs no install. To have it permanently:

```
npm i -g papervine
```

### Create a site

#### `papervine new [dir]`

Create a docs site in `[dir]`, defaulting to the current directory. The starter it writes
is a complete, working site — `docs.json`, a few pages, a component gallery, and an OpenAPI
example — so you can preview it immediately and delete what you don't want.

```
papervine new my-docs
```

**Options**

| Flag           | Description                                        |
| -------------- | -------------------------------------------------- |
| `-f, --force`  | Scaffold into a directory that isn't empty         |
| `-h, --help`   | Show help                                          |

A directory that isn't empty is refused unless you pass `--force`, since scaffolding writes
files and overwriting your work because of a mistyped path isn't recoverable. Directories
containing only dotfiles (a fresh `git init`, say) count as empty.

The template is bundled in the package, so `new` works offline and always matches the
version of the CLI that wrote it.

### Local preview

#### `papervine dev [dir]`

Serve the docs in `[dir]`, defaulting to the current directory. The directory must
contain a `docs.json` at its root.

```
papervine dev
```

**Options**

| Flag                | Description                                          | Default |
| ------------------- | ---------------------------------------------------- | ------- |
| `-p, --port <port>` | Port to serve on                                     | `3000`  |
| `-y, --yes`         | Create a starter site if there are no docs, no prompt | —       |
| `-h, --help`        | Show help                                            | —       |

**Nothing to preview yet?** Run in an empty folder and it offers to create a site rather
than just failing:

```
$ papervine dev
! no docs.json in /Users/you/my-docs
  Create a starter docs site here? [y/N]
```

The prompt only appears in an interactive terminal. In CI or a pipe it prints the error and
exits non-zero as before, because a prompt nobody can answer is worse than a clear failure.
Use `--yes` to scaffold without being asked.

**Preview a subfolder**

Docs usually live in a subdirectory of a larger repo:

```
papervine dev ./docs
```

**Custom port**

```
papervine dev --port 4000
```

Without `--port`, if `3000` is taken the CLI moves to the next free port. With an
explicit `--port` it fails instead of silently serving somewhere you didn't ask for.

**Editing**

Pages are rendered per request, so saving an `.mdx` file and refreshing the browser
shows the change. There is no hot reload — a refresh is the update.

By default the preview binds loopback (`127.0.0.1`) rather than every interface. Set
`HOSTNAME=0.0.0.0` to reach it from outside the machine, e.g. from a container host.

### Output

`papervine --help` and `papervine --version` print the command surface and the installed
version. Help and status output is colourised at a terminal and plain everywhere else, so
piping or redirecting gives you clean text rather than escape codes:

| Variable      | Effect                                                     |
| ------------- | ---------------------------------------------------------- |
| `NO_COLOR`    | Set to anything non-empty to disable colour entirely        |
| `FORCE_COLOR` | Set to keep colour through a pipe; `0` disables it          |

### What ships in this package

Just the renderer: MDX compilation, `docs.json` parsing, navigation, the component
set, and OpenAPI endpoint pages — the same engine that serves hosted Papervine sites,
compiled in.

It carries **none** of the hosted product: no authentication, database, object
storage, realtime, or AI assistant. Those are services of a hosted deployment, not
things a local previewer needs, so they are absent from the package rather than
disabled at runtime — nothing to install, and nothing to audit.

One visible consequence: the navbar's search palette and "Ask AI" button are hosted
features, so a local preview shows the docs chrome — logo, navigation, sidebar, table
of contents — without them.

### Compatibility

**Papervine is docs.json-compatible.** It reads the same MDX content and the same
`docs.json` navigation file, so an existing docs.json project renders as-is — no
migration step, no proprietary build, no conversion tool:

```
git clone https://github.com/your-org/your-docs
npx papervine dev ./your-docs
```

That also makes it a practical **GitBook or ReadMe alternative** if you'd rather keep
your docs as MDX files in your own repo than in someone's CMS. Your content stays
files you own.

Papervine is an independent project and is not affiliated with the incumbent, GitBook, or
ReadMe.

### Troubleshooting

**`no docs.json in <dir>`** — you're not in a docs repo root. Pass the folder that
contains `docs.json`, e.g. `papervine dev ./docs`.

**`port 3000 is already in use`** — pass `--port`, or drop the flag and let the CLI
pick the next free port.

**A component renders as plain text** — an unknown component degrades to its children
rather than failing the page. Check the spelling against the supported component set.

**Utility classes in your own MDX don't apply** — the stylesheet is compiled when this
package is built, so arbitrary Tailwind classes written in your MDX aren't in it. Use
the documented components and `docs.json` theming instead.

### Trust

`papervine dev` compiles and executes the repo's MDX, which is arbitrary JSX and
JavaScript. That's expected for your own docs, but it means you should only run it on
docs repos you trust — the same care you'd take before `npm install` in a project.

### Roadmap

`new` and `dev` are the surface today. Next up: `broken-links`, `validate`,
`openapi-check`, and `build` (static export).

### Get started

Docs at [papervine.io](https://papervine.io) · source and issues at
[github.com/papervine/cli](https://github.com/papervine/cli).

MIT licensed.
