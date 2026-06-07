import type { ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import { serialize } from "@mintlify/mdx/server";
import { run } from "@mdx-js/mdx";
import * as prodRuntime from "react/jsx-runtime";
import * as devRuntime from "react/jsx-dev-runtime";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { mdxComponents } from "@/components/mdx";

/**
 * MDX rendering — HYBRID: compile with @mintlify/mdx's `serialize` (the incumbent's own
 * renderer; gives us their Shiki dual-theme highlighting + snippet handling for
 * free), then execute the compiled source ourselves with @mdx-js/mdx's `run`.
 *
 * Why not their `MDXRemote`? It renders inside an RSC component and throws compile
 * errors at render time, which can't be caught without an error boundary (and a
 * boundary breaks RSC streaming). Running the compiled source ourselves keeps the
 * whole compile+execute step inside one try/catch, so an unsupported feature (e.g.
 * an unresolved /snippets import) degrades to a notice instead of 500'ing the page.
 *
 * The public surface (`Mdx`, `extractToc`) is unchanged.
 */
const development = process.env.NODE_ENV !== "production";

/** Components referenced in MDX but not implemented yet render their children (GAP-REPORT §2.3). */
function FallbackComponent({ children }: { children?: ReactNode }) {
  return <>{children ?? null}</>;
}

/** Proxy so member-expression components also degrade: `<Color.Item>` → another usable component. */
const Fallback: typeof FallbackComponent = new Proxy(FallbackComponent, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === "string" && /^[A-Z]/.test(prop)) return Fallback;
    return undefined;
  },
});

const warnedComponents = new Set<string>();

/**
 * Real components + a passthrough Fallback for every component the *compiled*
 * source references. Scanning compiledSource (not the raw page) is authoritative:
 * the MDX compiler emits `_missingMdxReference("Name")` for each component used,
 * including ones pulled in from resolved /snippets — so snippet-injected unknowns
 * (e.g. <Popup>) get a Fallback too and never throw at render.
 */
function componentsForCompiled(compiledSource: string): MDXComponents {
  const components: MDXComponents = { ...mdxComponents };
  for (const m of compiledSource.matchAll(/_missingMdxReference\("([A-Za-z][\w.]*)"/g)) {
    const name = m[1].split(".")[0]; // root of member expressions (Foo.Bar -> Foo)
    if (!/^[A-Z]/.test(name) || name in components) continue;
    components[name] = Fallback;
    if (!warnedComponents.has(name)) {
      warnedComponents.add(name);
      console.warn(`MDX: unknown component <${name}> — rendering children only`);
    }
  }
  return components;
}

/** the incumbent's bare code-title convention (```js Label) → rehype/highlighter title="Label". */
function remarkCodeTitles() {
  return (tree: { children?: unknown[] }) => {
    const visit = (node: Record<string, unknown>) => {
      if (node.type === "code" && typeof node.meta === "string") {
        const meta = node.meta.trim();
        if (meta && !meta.includes("=") && !meta.startsWith("{")) {
          node.meta = `title="${meta}"`;
        }
      }
      const children = node.children as Record<string, unknown>[] | undefined;
      if (Array.isArray(children)) children.forEach(visit);
    };
    visit(tree as Record<string, unknown>);
  };
}

// Compile in the same dev/prod mode we run with, so the JSX runtime matches —
// mixing prod-compiled elements with React's dev renderer throws (the React 19
// bug that made us drop next-mdx-remote originally).
const mdxOptions = {
  development,
  remarkPlugins: [remarkGfm, remarkCodeTitles],
  rehypePlugins: [rehypeSlug, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
} as const;

const syntaxHighlightingOptions = {
  themes: { light: "github-light", dark: "github-dark" },
  codeStyling: "system",
} as const;

export async function Mdx({ source }: { source: string }) {
  try {
    const result = await serialize({
      source,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mdxOptions: mdxOptions as any,
      syntaxHighlightingOptions,
      parseFrontmatter: false,
    });
    if (!("compiledSource" in result) || !result.compiledSource) {
      throw (result as { error?: unknown }).error ?? new Error("MDX serialize failed");
    }

    const components = componentsForCompiled(result.compiledSource);
    const runtime = development ? devRuntime : prodRuntime;
    const { default: Content } = await run(result.compiledSource, {
      ...(runtime as Parameters<typeof run>[1]),
      useMDXComponents: () => components,
      baseUrl: import.meta.url,
    });

    return <Content components={components} />;
  } catch (err) {
    // Don't let a single unsupported feature (e.g. an unresolved /snippets import,
    // GAP-REPORT §2.2) 500 the page — degrade to an inline notice.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`MDX render failed: ${message}`);
    return (
      <div className="my-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="m-0 font-medium">This page couldn’t be fully rendered yet.</p>
        {development && <p className="m-0 mt-1 font-mono text-xs opacity-80">{message}</p>}
      </div>
    );
  }
}

/** Extract h2/h3 headings from raw MDX for the right-hand table of contents. */
export type TocItem = { depth: number; text: string; id: string };

export function extractToc(source: string): TocItem[] {
  const toc: TocItem[] = [];
  const lines = source.split("\n");
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (match) {
      const depth = match[1].length;
      const text = match[2].replace(/[*_`]/g, "");
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      toc.push({ depth, text, id });
    }
  }
  return toc;
}
