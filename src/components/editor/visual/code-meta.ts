import { parseCodeTitle } from "@papervine/renderer/lib/code-title";

// Writing back what `parseCodeTitle` reads.
//
// A fence's label lives in its `meta` — the run of text after the language — as either a bare
// word (```bash npm) or an explicit `title="…"`. The renderer parses that to decide a code
// block's header and a <CodeGroup> tab's label, so the editor's tab strip has to write the form
// that same parser reads back; anything else and the tab you named says something different on
// the page.
//
// Meta can hold other directives too (`{1,3-4}` line ranges, `key=value` flags we don't model but
// must not eat), so this replaces the title in place and leaves the rest alone.

/** The `title="…"` form, wherever it appears in the meta. */
const EXPLICIT = /(?:^|\s)title=(?:"[^"]*"|'[^']*')/;

/** Quote only when the label needs it — a bare word round-trips as the bare form authors write. */
function quoted(title: string): string {
  return `title="${title.replace(/"/g, "'")}"`;
}

/**
 * `meta` with its title set to `title` — or with the title removed when it's empty.
 *
 * Returns null when nothing is left, so the caller can store `meta: null` and the fence
 * serializes as a bare ```lang rather than ```lang with a trailing space.
 */
export function withCodeTitle(meta: string | null, title: string): string | null {
  const rest = stripTitle(meta ?? "");
  const label = title.trim().replace(/\s+/g, " ");
  if (!label) return rest || null;
  // The bare form is only safe when the label has the meta to itself: `parseCodeTitle` reads a
  // bare label as the WHOLE meta, so `app.ts {1,3}` would come back titled "app.ts {1,3}".
  // A label needing quotes takes the explicit form for the same reason.
  const written = !rest && /^[^\s"'{=]+$/.test(label) ? label : quoted(label);
  return [written, rest].filter(Boolean).join(" ");
}

/**
 * The meta with any title taken out, keeping every other directive in its original order.
 *
 * Mirrors `parseCodeTitle`'s reading exactly, greediness included: with no `title=` present it
 * treats a bare label as the entire meta, because that is what the renderer will do with it.
 */
function stripTitle(meta: string): string {
  const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
  const withoutExplicit = meta.replace(EXPLICIT, " ").trim();
  if (withoutExplicit !== meta.trim()) return collapse(withoutExplicit);
  // No `title=`: either the meta is directives only (no title to strip) or it is all label.
  return parseCodeTitle(meta) ? "" : collapse(meta);
}

/** What a tab shows for a block: its title, else its language, else a placeholder. */
export function codeTabLabel(meta: string | null, language: string | null): string {
  return parseCodeTitle(meta) ?? (language || "").trim();
}

/**
 * The languages offered in the picker. Deliberately a curated list rather than every grammar the
 * highlighter knows: the point of the control is naming the language you're writing, and a
 * thousand-row menu is worse at that than forty. Anything exotic is still one word in Source mode,
 * and an unknown language degrades to unhighlighted code rather than breaking.
 *
 * `alt` holds the spellings authors actually type (```ts, ```py, ```yml). They're matched by the
 * search AND by `languageLabel`, so a fence already written the short way shows its friendly name
 * instead of falling through as "unlisted".
 */
export interface CodeLanguage {
  id: string;
  label: string;
  alt?: string[];
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "", label: "Plain Text", alt: ["text", "plaintext", "txt"] },
  { id: "bash", label: "Bash", alt: ["sh", "shell", "zsh", "shellscript", "console"] },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++", alt: ["c++"] },
  { id: "csharp", label: "C#", alt: ["cs", "c#"] },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff", alt: ["patch"] },
  { id: "docker", label: "Dockerfile", alt: ["dockerfile"] },
  { id: "elixir", label: "Elixir", alt: ["ex"] },
  { id: "go", label: "Go", alt: ["golang"] },
  { id: "graphql", label: "GraphQL", alt: ["gql"] },
  { id: "groovy", label: "Groovy" },
  { id: "haskell", label: "Haskell", alt: ["hs"] },
  { id: "html", label: "HTML" },
  { id: "http", label: "HTTP" },
  { id: "ini", label: "INI", alt: ["conf", "properties"] },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript", alt: ["js", "mjs", "cjs", "node"] },
  { id: "json", label: "JSON", alt: ["jsonc", "json5"] },
  { id: "jsx", label: "JSX" },
  { id: "kotlin", label: "Kotlin", alt: ["kt"] },
  { id: "lua", label: "Lua" },
  { id: "markdown", label: "Markdown", alt: ["md"] },
  { id: "mdx", label: "MDX" },
  { id: "mermaid", label: "Mermaid" },
  { id: "nginx", label: "Nginx" },
  { id: "objective-c", label: "Objective-C", alt: ["objc"] },
  { id: "php", label: "PHP" },
  { id: "powershell", label: "PowerShell", alt: ["ps", "ps1", "pwsh"] },
  { id: "prisma", label: "Prisma" },
  { id: "python", label: "Python", alt: ["py"] },
  { id: "r", label: "R" },
  { id: "ruby", label: "Ruby", alt: ["rb"] },
  { id: "rust", label: "Rust", alt: ["rs"] },
  { id: "scala", label: "Scala" },
  { id: "sql", label: "SQL" },
  { id: "swift", label: "Swift" },
  { id: "toml", label: "TOML" },
  { id: "tsx", label: "TSX" },
  { id: "typescript", label: "TypeScript", alt: ["ts", "mts", "cts"] },
  { id: "xml", label: "XML", alt: ["svg", "plist"] },
  { id: "yaml", label: "YAML", alt: ["yml"] },
];

/** The entry a fence's language names — by id or by one of the spellings authors write. */
function findLanguage(language: string): CodeLanguage | undefined {
  const id = language.toLowerCase();
  return CODE_LANGUAGES.find((l) => l.id === id || l.alt?.includes(id));
}

/** The listed id a fence's language resolves to — `ts` and `typescript` are the same entry. */
export function canonicalLanguageId(language: string | null): string {
  const id = (language ?? "").trim();
  return findLanguage(id)?.id ?? id;
}

/** The picker's label for a fence's language — including one we don't list, shown as written. */
export function languageLabel(language: string | null): string {
  const id = (language ?? "").trim();
  return findLanguage(id)?.label ?? id;
}

/** Case-insensitive match on label, id, or alias, so "ts" finds TypeScript and "Type" does too. */
export function filterLanguages(query: string): CodeLanguage[] {
  const q = query.trim().toLowerCase();
  if (!q) return CODE_LANGUAGES;
  return CODE_LANGUAGES.filter(
    (l) =>
      l.label.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      l.alt?.some((a) => a.includes(q)),
  );
}
