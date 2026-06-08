import type { Metadata } from "next";
import Link from "next/link";

// Marketing landing for the SaaS apex (SPEC §2 — the public front door, distinct
// from the dashboard at /dashboard and tenant docs at {slug}.host). Reached via the
// middleware rewrite of `/` when not in single-repo preview mode (no DOCBOT_CONTENT).
export const metadata: Metadata = {
  title: "Docbot — beautiful docs from your Git repo",
  description:
    "Open-source, self-hostable documentation platform. Point it at a Git repo of MDX + docs.json and get a fast, searchable docs site with an API playground and AI assistant.",
};

const GITHUB = "https://github.com/phishy/docbot";

const FEATURES = [
  {
    title: "docs.json-compatible",
    body: "the incumbent's schema, supported. Point Docbot at an existing repo and it renders unchanged.",
  },
  {
    title: "API playground",
    body: "Drop in an OpenAPI spec and get auto-generated, in-nav endpoint reference pages.",
  },
  {
    title: "AI assistant",
    body: "Conversational search over your docs, grounded in your content with citations.",
  },
  {
    title: "Open-source & self-hostable",
    body: "MIT-spirited. Run the hosted SaaS or your own instance — no lock-in.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold">Docbot</span>
        <nav className="flex items-center gap-5 text-sm">
          <a href={GITHUB} className="text-zinc-600 hover:text-zinc-900">
            GitHub
          </a>
          <Link href="/login" className="text-zinc-600 hover:text-zinc-900">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-emerald-600 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-500"
          >
            Sign up
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h1 className="text-5xl font-bold tracking-tight">
            Beautiful docs from your Git repo.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-600">
            Docbot turns a repo of MDX + a <code className="text-emerald-700">docs.json</code> into
            a fast, searchable documentation site — with an API playground and an AI assistant.
            Open-source and self-hostable.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Get started — free
            </Link>
            <a
              href={GITHUB}
              className="rounded-lg border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              View on GitHub
            </a>
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            Already migrating from the incumbent? Your <code>docs.json</code> works as-is.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-zinc-200 p-6">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-zinc-50">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold">Connect a repo. Ship docs.</h2>
            <p className="max-w-md text-zinc-600">
              Sign up, point Docbot at a public GitHub repo, and your docs are live.
            </p>
            <Link
              href="/signup"
              className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-zinc-500">
        <span>© Docbot — open source</span>
        <div className="flex gap-5">
          <a href={GITHUB} className="hover:text-zinc-900">
            GitHub
          </a>
          <Link href="/login" className="hover:text-zinc-900">
            Log in
          </Link>
        </div>
      </footer>
    </div>
  );
}
