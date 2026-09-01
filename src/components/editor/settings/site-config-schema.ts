import {
  BarChart3,
  Bot,
  Braces,
  Camera,
  Code,
  CornerUpRight,
  FileQuestion,
  FileText,
  Flag,
  Globe,
  Image as ImageIcon,
  ListTree,
  MousePointerClick,
  Palette,
  PanelBottom,
  PanelTop,
  Route,
  Search,
  Share2,
  Type,
  Variable,
  type LucideIcon,
} from "lucide-react";
import { themes } from "@papervine/renderer/lib/theme";

// What the Site settings drawer shows, as DATA. One entry per `docs.json` field: where it lives in
// the file, what control edits it, and a sentence saying what it does.
//
// A schema rather than a hand-built form for the obvious reason — this is the whole docs.json
// surface, and a form written by hand is a form where field 60 disagrees with field 3 about
// spacing, help text, and how it saves. It also means adding a field is one object literal.
//
// THE SHAPE COMES FROM THE JSON SCHEMA at https://papervine.io/docs.json — the one real repos set
// as their `$schema`, and the compatibility contract this platform is built on (CLAUDE.md). Field
// names, nesting and enums are taken from it rather than guessed, so what the drawer writes is a
// valid config for any tool that reads the format.
//
// **`rendered: false` is the honesty mark.** `docs.json` is a compatibility surface, so a config
// legitimately carries blocks Papervine keeps byte-for-byte but doesn't consume yet (`api`,
// `redirects`, `integrations`, `fonts`, …). Those fields are still HERE and still editable — the
// file is portable and it's the customer's config, so being unable to set a key you rely on
// elsewhere is worse than setting one we don't read — but they're labelled, so nobody edits a
// field expecting the page to change. Drop the mark the day the renderer honours the key.

export type FieldKind =
  | "text"
  | "number"
  | "textarea"
  | "toggle"
  | "select"
  | "color"
  | "linkList"
  /** One label+href pair, written only when both halves are filled in. */
  | "linkPair"
  /** A light/dark image pair (`logo`, `favicon`) — string or `{light, dark}` in the file. */
  | "imagePair"
  /** Free-form string list (`api.examples.languages`). */
  | "tags"
  /** Fixed set of string values, any number of them (`contextual.options`). */
  | "multiselect"
  /** Footer link columns: `[{ header, items: [{ label, href }] }]`. */
  | "footerColumns"
  /** `[{ source, destination, permanent }]`. */
  | "redirects"
  | "keyValue";

export interface ConfigField {
  /** Where the value lives in docs.json. */
  path: string[];
  label: string;
  /** One sentence: what it does and where it shows up. */
  help?: string;
  kind: FieldKind;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** `imagePair` only: also offer the link the image points at (`logo.href`). */
  hasHref?: boolean;
  /** `keyValue` only: what one row IS ("meta tag", "social link"), for the add/remove labels. */
  itemNoun?: string;
  /** `keyValue` only: placeholders for the name and value inputs. */
  itemPlaceholders?: [string, string];
  /**
   * False when Papervine keeps the key but doesn't render it yet. Defaults to true; only ever set
   * inside a section that IS rendered, since a whole unrendered section says so once at its head.
   */
  rendered?: boolean;
}

export interface ConfigSection {
  id: string;
  title: string;
  icon: LucideIcon;
  /** Shown under the section heading, before the fields. */
  blurb?: string;
  fields: ConfigField[];
  /** Rendered instead of `fields` — for a section with its own editor (the nav tree). */
  custom?: "navigation";
  /** False when nothing in this section changes what Papervine renders (yet). */
  rendered?: boolean;
}

const themeOptions = Object.keys(themes).map((name) => ({
  value: name,
  label: name.charAt(0).toUpperCase() + name.slice(1),
}));

/** Every AI/agent surface `contextual.options` can offer, per the schema's enum. */
const CONTEXTUAL_OPTIONS = [
  "copy",
  "view",
  "assistant",
  "download-pdf",
  "download-spec",
  "chatgpt",
  "claude",
  "perplexity",
  "grok",
  "aistudio",
  "devin",
  "windsurf",
  "cursor",
  "vscode",
  "mcp",
  "add-mcp",
  "devin-mcp",
].map((value) => ({ value, label: value }));

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    id: "general",
    title: "General",
    icon: Globe,
    fields: [
      {
        path: ["name"],
        label: "Name",
        help: "The site's name — shown in the navbar and used as the browser tab's title.",
        kind: "text",
        placeholder: "Acme Docs",
      },
      {
        path: ["description"],
        label: "Description",
        help: "One line about the site. Used for search engines and AI answers.",
        kind: "textarea",
        placeholder: "Everything you need to build with Acme.",
      },
      {
        path: ["public"],
        label: "Public",
        help: "Declares the site as publicly readable. Papervine's own access control is in Settings → Reader access, not here.",
        kind: "toggle",
        rendered: false,
      },
    ],
  },
  {
    id: "navigation",
    title: "Navigation",
    icon: ListTree,
    blurb: "The pages and groups in your sidebar, in the order readers see them.",
    fields: [],
    custom: "navigation",
  },
  {
    id: "branding",
    title: "Branding",
    icon: ImageIcon,
    fields: [
      {
        // One field over the whole `logo` key, not three over `logo.light`/`.dark`/`.href`:
        // `logo` is EITHER a string or `{light, dark, href}`, so a per-sub-path control shows a
        // string-form logo as empty and then overwrites it with an object on the first keystroke.
        // `logoValue`/`logoParts` read both shapes and write back the one a hand-written file
        // would have.
        path: ["logo"],
        label: "Logo",
        help: "Paths in your repo. The light file shows on dark backgrounds and vice versa; give one file and it's used for both.",
        kind: "imagePair",
        hasHref: true,
        placeholder: "/logo/light.svg",
      },
      {
        path: ["favicon"],
        label: "Favicon",
        help: "The browser-tab icon.",
        kind: "imagePair",
        placeholder: "/favicon.svg",
      },
      {
        path: ["icons", "library"],
        label: "Icon library",
        help: "Which icon set an `icon=` attribute names. Papervine renders Lucide icons today.",
        kind: "select",
        options: [
          { value: "lucide", label: "Lucide" },
          { value: "fontawesome", label: "Font Awesome" },
          { value: "tabler", label: "Tabler" },
        ],
        rendered: false,
      },
    ],
  },
  {
    id: "styling",
    title: "Styling",
    icon: Palette,
    fields: [
      {
        path: ["theme"],
        label: "Theme",
        help: "The named layout preset your site renders with.",
        kind: "select",
        options: themeOptions,
      },
      {
        path: ["colors", "primary"],
        label: "Primary color",
        help: "Links, buttons and accents.",
        kind: "color",
        placeholder: "#16A34A",
      },
      {
        path: ["colors", "light"],
        label: "Light color",
        help: "Used as the accent in dark mode, where the primary can be too dark to read.",
        kind: "color",
        placeholder: "#07C983",
      },
      {
        path: ["colors", "dark"],
        label: "Dark color",
        help: "Used as the accent in light mode.",
        kind: "color",
        placeholder: "#15803D",
      },
      {
        path: ["appearance", "default"],
        label: "Default appearance",
        help: "Which mode a first-time reader gets. System follows their device.",
        kind: "select",
        options: [
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        path: ["appearance", "strict"],
        label: "Lock the appearance",
        help: "Hides the light/dark toggle, so every reader sees the default above.",
        kind: "toggle",
      },
      {
        path: ["styling", "eyebrows"],
        label: "Page eyebrow",
        help: "What sits above a page title — its section name, or a breadcrumb trail.",
        kind: "select",
        options: [
          { value: "section", label: "Section" },
          { value: "breadcrumbs", label: "Breadcrumbs" },
        ],
        rendered: false,
      },
      {
        path: ["styling", "latex"],
        label: "LaTeX",
        help: "Render math expressions in your MDX.",
        kind: "toggle",
        rendered: false,
      },
      {
        path: ["background", "decoration"],
        label: "Background decoration",
        kind: "select",
        options: [
          { value: "gradient", label: "Gradient" },
          { value: "grid", label: "Grid" },
          { value: "windows", label: "Windows" },
        ],
        rendered: false,
      },
      {
        path: ["background", "color", "light"],
        label: "Background (light)",
        kind: "color",
        rendered: false,
      },
      {
        path: ["background", "color", "dark"],
        label: "Background (dark)",
        kind: "color",
        rendered: false,
      },
      {
        path: ["background", "image"],
        label: "Background image",
        help: "A path in your repo, or separate files per mode.",
        kind: "imagePair",
        placeholder: "/images/bg-light.png",
        rendered: false,
      },
    ],
  },
  {
    id: "typography",
    title: "Typography",
    icon: Type,
    blurb: "A custom typeface for the whole site, or different ones for headings and body.",
    rendered: false,
    fields: [
      { path: ["fonts", "family"], label: "Family", kind: "text", placeholder: "Inter" },
      {
        path: ["fonts", "weight"],
        label: "Weight",
        help: "A single weight, for a font file that isn't variable.",
        kind: "number",
        placeholder: "400",
      },
      {
        path: ["fonts", "source"],
        label: "Source",
        help: "A URL or a path in your repo. Needed for anything that isn't a Google Font.",
        kind: "text",
        placeholder: "https://example.com/fonts/Inter.woff2",
      },
      {
        path: ["fonts", "format"],
        label: "Format",
        kind: "select",
        options: [
          { value: "woff", label: "woff" },
          { value: "woff2", label: "woff2" },
        ],
      },
      {
        path: ["fonts", "heading", "family"],
        label: "Heading family",
        help: "Overrides the family above for headings only.",
        kind: "text",
        placeholder: "Space Grotesk",
      },
      {
        path: ["fonts", "body", "family"],
        label: "Body family",
        kind: "text",
        placeholder: "Inter",
      },
    ],
  },
  {
    id: "navbar",
    title: "Navbar",
    icon: PanelTop,
    fields: [
      {
        path: ["navbar", "links"],
        label: "Links",
        help: "Shown across the top of every page.",
        kind: "linkList",
      },
      {
        // One field, not two, because the config's `navbar` block is all-or-nothing: `primary`
        // requires BOTH keys, and a half-written one makes the parser discard the whole navbar —
        // taking the links above with it. So the pair is written only once it's complete.
        path: ["navbar", "primary"],
        label: "Call to action",
        help: "The highlighted button at the end of the navbar. It appears once it has both a label and a link.",
        kind: "linkPair",
      },
    ],
  },
  {
    id: "footer",
    title: "Footer",
    icon: PanelBottom,
    blurb: "Social links and columns of links below every page.",
    rendered: false,
    fields: [
      {
        path: ["footer", "socials"],
        label: "Socials",
        help: "One row per network — x, github, linkedin, discord, slack, youtube, bluesky, website…",
        kind: "keyValue",
        itemNoun: "social link",
        itemPlaceholders: ["github", "https://github.com/acme"],
      },
      {
        path: ["footer", "links"],
        label: "Link columns",
        kind: "footerColumns",
      },
    ],
  },
  {
    id: "banner",
    title: "Banner",
    icon: Flag,
    blurb: "An announcement bar above the navbar, on every page. Empty content means no banner.",
    fields: [
      {
        path: ["banner", "content"],
        label: "Content",
        // Plain text on purpose: the site-wide banner renders its config value as-is (the MDX
        // `<Banner>` takes children, the config path takes a string), so promising markdown here
        // would show readers the literal brackets.
        help: "Plain text, shown on every page above the navbar.",
        kind: "text",
        placeholder: "We just shipped v2 — see the changelog.",
      },
      {
        path: ["banner", "type"],
        label: "Tone",
        kind: "select",
        options: [
          { value: "info", label: "Info" },
          { value: "warning", label: "Warning" },
          { value: "critical", label: "Critical" },
        ],
      },
      {
        path: ["banner", "color"],
        label: "Custom color",
        help: "Overrides the tone above with a background colour of your own.",
        kind: "color",
      },
      {
        path: ["banner", "dismissible"],
        label: "Readers can dismiss it",
        kind: "toggle",
      },
    ],
  },
  {
    id: "content",
    title: "Content",
    icon: FileText,
    fields: [
      {
        path: ["markdown", "instructions"],
        label: "AI instructions",
        help: "Free-form guidance for an agent reading these docs — “the v2 pages supersede v1”, “cite the version you read”. Emitted into /llms.txt.",
        kind: "textarea",
        placeholder: "Prefer the v2 pages; they supersede everything under /v1.",
      },
      {
        path: ["markdown", "schema"],
        label: "Strict frontmatter",
        help: "Validates page frontmatter against the schema instead of ignoring unknown keys.",
        kind: "toggle",
        rendered: false,
      },
      {
        path: ["metadata", "timestamp"],
        label: "Show last updated",
        help: "Prints each page's last-modified date under its title.",
        kind: "toggle",
        rendered: false,
      },
    ],
  },
  {
    id: "codeblocks",
    title: "Codeblocks",
    icon: Code,
    blurb:
      "Papervine highlights code with Shiki in both light and dark, keyed to the reader's appearance. A custom Shiki theme is a per-theme object — edit that in the file.",
    rendered: false,
    fields: [
      {
        path: ["styling", "codeblocks"],
        label: "Codeblock appearance",
        help: "System follows the reader's mode; dark keeps code dark in both.",
        kind: "select",
        options: [
          { value: "system", label: "System" },
          { value: "dark", label: "Always dark" },
        ],
      },
    ],
  },
  {
    id: "context-menu",
    title: "Context menu",
    icon: MousePointerClick,
    blurb: "The per-page actions readers get for handing a page to an AI tool.",
    rendered: false,
    fields: [
      {
        path: ["contextual", "options"],
        label: "Options",
        help: "Copy the page, open it in ChatGPT or Claude, add it to Cursor or VS Code, expose the MCP endpoint…",
        kind: "multiselect",
        options: CONTEXTUAL_OPTIONS,
      },
      {
        path: ["contextual", "display"],
        label: "Placement",
        kind: "select",
        options: [
          { value: "header", label: "Page header" },
          { value: "toc", label: "Table of contents" },
        ],
      },
    ],
  },
  {
    id: "navigation-behavior",
    title: "Navigation behavior",
    icon: Route,
    rendered: false,
    fields: [
      {
        path: ["interaction", "drilldown"],
        label: "Drill-down navigation",
        help: "Clicking a group opens it as its own view instead of expanding it in place.",
        kind: "toggle",
      },
      {
        path: ["seo", "trailingSlash"],
        label: "Trailing slashes",
        help: "Write page URLs as /guides/intro/ rather than /guides/intro.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "search",
    title: "Search",
    icon: Search,
    rendered: false,
    fields: [
      {
        path: ["search", "prompt"],
        label: "Placeholder",
        help: "The text inside the empty search box.",
        kind: "text",
        placeholder: "Search or ask…",
      },
    ],
  },
  {
    id: "api",
    title: "API reference",
    icon: Braces,
    blurb:
      "Papervine builds API pages from the `openapi` reference inside a navigation group, which is where a real repo puts it. These top-level keys are kept for portability.",
    rendered: false,
    fields: [
      {
        path: ["api", "openapi"],
        label: "OpenAPI spec",
        help: "A path in your repo or a URL.",
        kind: "text",
        placeholder: "/api-reference/openapi.json",
      },
      {
        path: ["api", "asyncapi"],
        label: "AsyncAPI spec",
        kind: "text",
        placeholder: "/api-reference/asyncapi.json",
      },
      {
        path: ["api", "params", "expanded"],
        label: "Parameters",
        kind: "select",
        options: [
          { value: "all", label: "All expanded" },
          { value: "closed", label: "Collapsed" },
        ],
      },
      {
        path: ["api", "playground", "display"],
        label: "Playground",
        kind: "select",
        options: [
          { value: "interactive", label: "Interactive" },
          { value: "simple", label: "Simple" },
          { value: "auth", label: "Auth only" },
          { value: "none", label: "Hidden" },
        ],
      },
      {
        path: ["api", "playground", "proxy"],
        label: "Proxy requests",
        help: "Sends playground requests through the docs host instead of the browser.",
        kind: "toggle",
      },
      {
        path: ["api", "examples", "languages"],
        label: "Example languages",
        help: "Which snippets to generate, in order — curl, python, javascript…",
        kind: "tags",
      },
      {
        path: ["api", "examples", "defaults"],
        label: "Example fields",
        kind: "select",
        options: [
          { value: "required", label: "Required only" },
          { value: "all", label: "All" },
        ],
      },
      {
        path: ["api", "mdx", "server"],
        label: "Base URL",
        help: "The server MDX-authored endpoint pages send requests to.",
        kind: "text",
        placeholder: "https://api.example.com/v1",
      },
    ],
  },
  {
    id: "redirects",
    title: "Redirects",
    icon: CornerUpRight,
    blurb: "Old paths that should land somewhere new.",
    rendered: false,
    fields: [{ path: ["redirects"], label: "Rules", kind: "redirects" }],
  },
  {
    id: "seo",
    title: "SEO",
    icon: Share2,
    fields: [
      {
        path: ["seo", "indexing"],
        label: "Indexing",
        help: "Navigable indexes only pages in your navigation; all indexes every page in the repo.",
        kind: "select",
        options: [
          { value: "navigable", label: "Navigable" },
          { value: "all", label: "All pages" },
        ],
      },
      {
        path: ["seo", "metatags"],
        label: "Meta tags",
        help: "Added to every page — an og:image, a verification token. A page's own frontmatter wins.",
        kind: "keyValue",
        itemNoun: "meta tag",
        itemPlaceholders: ["og:image", "https://…/og.png"],
      },
      {
        path: ["seo", "organization", "name"],
        label: "Organization name",
        help: "Structured data about who publishes these docs.",
        kind: "text",
        placeholder: "Acme, Inc.",
        rendered: false,
      },
      {
        path: ["seo", "organization", "url"],
        label: "Organization URL",
        kind: "text",
        placeholder: "https://example.com",
        rendered: false,
      },
      {
        path: ["seo", "organization", "logo"],
        label: "Organization logo",
        kind: "text",
        placeholder: "https://example.com/logo.png",
        rendered: false,
      },
    ],
  },
  {
    id: "thumbnails",
    title: "Thumbnails",
    icon: Camera,
    blurb: "The social-card image generated for each page.",
    rendered: false,
    fields: [
      {
        path: ["thumbnails", "appearance"],
        label: "Appearance",
        kind: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        path: ["thumbnails", "background"],
        label: "Background",
        help: "An image path or URL behind the card's text.",
        kind: "text",
        placeholder: "/images/og-background.png",
      },
      { path: ["thumbnails", "fonts", "family"], label: "Font family", kind: "text", placeholder: "Inter" },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: BarChart3,
    blurb:
      "Third-party analytics, per the schema's `integrations` block. Papervine records its own page views and search terms in Insights without any of this.",
    rendered: false,
    fields: [
      {
        path: ["integrations", "ga4", "measurementId"],
        label: "Google Analytics 4",
        kind: "text",
        placeholder: "G-XXXXXXXXXX",
      },
      {
        path: ["integrations", "gtm", "tagId"],
        label: "Google Tag Manager",
        kind: "text",
        placeholder: "GTM-XXXXXXX",
      },
      {
        path: ["integrations", "posthog", "apiKey"],
        label: "PostHog key",
        kind: "text",
        placeholder: "phc_…",
      },
      {
        path: ["integrations", "posthog", "apiHost"],
        label: "PostHog host",
        help: "Only needed for a self-hosted instance.",
        kind: "text",
        placeholder: "https://eu.posthog.com",
      },
      {
        path: ["integrations", "plausible", "domain"],
        label: "Plausible domain",
        kind: "text",
        placeholder: "docs.example.com",
      },
      {
        path: ["integrations", "mixpanel", "projectToken"],
        label: "Mixpanel token",
        kind: "text",
      },
      { path: ["integrations", "amplitude", "apiKey"], label: "Amplitude key", kind: "text" },
      { path: ["integrations", "fathom", "siteId"], label: "Fathom site ID", kind: "text" },
      { path: ["integrations", "heap", "appId"], label: "Heap app ID", kind: "text" },
      { path: ["integrations", "clarity", "projectId"], label: "Clarity project ID", kind: "text" },
      { path: ["integrations", "hotjar", "hjid"], label: "Hotjar ID", kind: "text" },
      { path: ["integrations", "intercom", "appId"], label: "Intercom app ID", kind: "text" },
      { path: ["integrations", "koala", "publicApiKey"], label: "Koala key", kind: "text" },
      { path: ["integrations", "logrocket", "appId"], label: "LogRocket app ID", kind: "text" },
      { path: ["integrations", "segment", "key"], label: "Segment key", kind: "text" },
    ],
  },
  {
    id: "errors",
    title: "404 page",
    icon: FileQuestion,
    blurb: "What a reader sees at a URL that doesn't exist.",
    rendered: false,
    fields: [
      {
        path: ["errors", "404", "redirect"],
        label: "Redirect to the home page",
        // The format's default is ON, so "Off" here means "unset", not "disabled" — say so rather
        // than letting the switch imply a choice nobody made.
        help: "On unless you set it otherwise; turn it off to show the page below instead.",
        kind: "toggle",
      },
      { path: ["errors", "404", "title"], label: "Title", kind: "text", placeholder: "Page not found" },
      {
        path: ["errors", "404", "description"],
        label: "Description",
        kind: "textarea",
        placeholder: "The page you were looking for has moved.",
      },
    ],
  },
  {
    id: "variables",
    title: "Variables",
    icon: Variable,
    blurb: "Values you can reuse across pages instead of repeating them.",
    rendered: false,
    fields: [
      {
        path: ["variables"],
        label: "Variables",
        kind: "keyValue",
        itemNoun: "variable",
        itemPlaceholders: ["productName", "Acme Cloud"],
      },
    ],
  },
];

/** Every path the drawer can write, for the tests that keep this schema honest. */
export function allFieldPaths(): string[][] {
  return CONFIG_SECTIONS.flatMap((s) => s.fields.map((f) => f.path));
}

/** True when Papervine renders this field's key today (a section's mark covers its fields). */
export function fieldIsRendered(section: ConfigSection, field: ConfigField): boolean {
  if (section.rendered === false) return false;
  return field.rendered !== false;
}

/** The paths this renderer actually consumes — the set the round-trip test asserts against. */
export function renderedFieldPaths(): string[][] {
  return CONFIG_SECTIONS.flatMap((s) => s.fields.filter((f) => fieldIsRendered(s, f)).map((f) => f.path));
}
