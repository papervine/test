// Video and embed handling for the editor, kept pure and DB-free so every decision here is
// unit-testable: which URLs are safe to put in a page, how a share link becomes an embed link,
// what markup gets inserted, and how to read that markup back well enough to render a live
// player in the Visual editor.
//
// Why raw `<video>` / `<iframe>` rather than a `<Video>` component: the docs.json-compatible
// platform we target has no video component — its own guidance is
// `<video controls className="w-full aspect-video rounded-xl" src="…">` and the equivalent
// iframe. Emitting exactly that keeps a page portable in both directions, which a bespoke
// component would not. (It also means the converter leaves it as an opaque raw block, so it
// round-trips byte-exact — verified.)

/** The classes that guidance tells authors to put on media. Also see tailwind.config's safelist:
 *  tenant MDX is fetched at request time, so Tailwind never scans it and these must be kept
 *  explicitly or they get purged. */
export const MEDIA_CLASSES = "w-full aspect-video rounded-xl";

/** What a YouTube/Vimeo iframe needs to actually play and go fullscreen. */
const IFRAME_ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";

export type EmbedProvider = "youtube" | "vimeo" | "loom";

/** The `/` menu entries that need a URL before they can insert anything. */
export type MediaInputKind = "image" | "video" | "embed";

/**
 * Copy for the dialog that collects that URL. Here rather than in the component so the wording
 * is data — the menu item and the dialog can't drift into describing different things, and a meta
 * test can assert every kind is complete.
 */
export const MEDIA_INPUTS: Record<
  MediaInputKind,
  { title: string; description: string; label: string; placeholder: string; submit: string }
> = {
  image: {
    title: "Select image",
    description: "Choose an image this site already has, or upload one.",
    label: "Image URL or path",
    placeholder: "/images/hero.png",
    submit: "Add image",
  },
  video: {
    title: "Select video",
    description: "Choose a video this site already has, or upload one.",
    label: "Video URL or path",
    placeholder: "/videos/demo.mp4",
    submit: "Add video",
  },
  embed: {
    title: "Embed",
    description:
      "Paste the link from your address bar — YouTube, Loom and Vimeo are converted to their embeddable form.",
    label: "Embed URL",
    placeholder: "https://www.youtube.com/watch?v=…",
    submit: "Add embed",
  },
};

/**
 * Is this something we're willing to write into a page?
 *
 * Authors can already type anything in Source mode, so this isn't a security boundary — it's a
 * guard on the one path where a *pasted* string becomes markup without being read first. A
 * `javascript:` or `data:` URL in a published `<iframe src>` runs for every reader, so the
 * insert path accepts only http(s), protocol-relative, and site-relative paths.
 */
export function isSafeMediaUrl(input: string): boolean {
  const url = input.trim();
  if (url === "") return false;
  // Site-relative: a path into the repo's own assets. Reject `//evil.com`-style
  // protocol-relative disguised as a path by checking for the double slash separately.
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (url.startsWith("//")) return true; // protocol-relative to an external host
  return /^https?:\/\//i.test(url);
}

/**
 * Turn a share link into an embeddable one. Pasting the URL from the browser's address bar is
 * what people actually do, and every provider serves a *different* URL for framing — so without
 * this the iframe renders that provider's "watch this on our site" page, or refuses to frame at
 * all.
 *
 * Anything unrecognized passes through untouched: plenty of things are embeddable (a CodeSandbox,
 * a Figma file, another docs site) and guessing wrong is worse than not guessing.
 */
export function toEmbedUrl(input: string): { provider: EmbedProvider | null; url: string } {
  const raw = input.trim();

  const youtube = matchYouTube(raw);
  if (youtube) return { provider: "youtube", url: youtube };

  const vimeo = raw.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i);
  if (vimeo) return { provider: "vimeo", url: `https://player.vimeo.com/video/${vimeo[1]}` };

  const loom = raw.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/i);
  if (loom) return { provider: "loom", url: `https://www.loom.com/embed/${loom[1]}` };

  return { provider: null, url: raw };
}

function matchYouTube(raw: string): string | null {
  const id =
    raw.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,})/i)?.[1] ??
    raw.match(/^https?:\/\/youtu\.be\/([\w-]{6,})/i)?.[1] ??
    raw.match(/^https?:\/\/(?:www\.)?youtube\.com\/(?:shorts|live|embed)\/([\w-]{6,})/i)?.[1];
  if (!id) return null;
  // Carry a timestamp across rather than dropping it: `?t=90` on a watch link becomes `?start=90`
  // on an embed link, and silently losing the one thing the author chose to link to is a bug.
  const seconds = raw.match(/[?&]t=(\d+)/)?.[1] ?? raw.match(/[?&]start=(\d+)/)?.[1];
  return `https://www.youtube.com/embed/${id}${seconds ? `?start=${seconds}` : ""}`;
}

/** A URL going into a JSX attribute. Percent-encoding a quote keeps the URL valid where an HTML
 *  entity would not — `&quot;` inside a JSX string literal stays literal. */
function attr(url: string): string {
  return url.replace(/"/g, "%22");
}

/** `<video>` markup for a file the site serves (or any direct media URL). */
export function videoMarkup(src: string): string {
  return `<video controls className="${MEDIA_CLASSES}" src="${attr(src)}"></video>`;
}

/** `<iframe>` markup for a third-party embed, with the share URL already resolved. */
export function embedMarkup(url: string, title = "Embedded content"): string {
  return (
    `<iframe className="${MEDIA_CLASSES}" src="${attr(url)}" title="${title}" ` +
    `allow="${IFRAME_ALLOW}" allowFullScreen></iframe>`
  );
}

// ── Reading it back ────────────────────────────────────────────────────────────
// The converter keeps raw HTML as an opaque block whose `raw` attr is the source text, which is
// what makes the round-trip byte-exact. To show a live player in the editor we therefore have to
// read that text — but only far enough to recognize the two shapes we emit, and only into an
// allowlisted set of props. Anything we don't understand falls back to showing the source, which
// is what it did before.

export type MediaElement = {
  tag: "video" | "iframe";
  src: string;
  className?: string;
  title?: string;
  poster?: string;
  /** Boolean attributes present on the element (controls, muted, loop, autoPlay, …). */
  flags: string[];
};

const BOOLEAN_ATTRS = new Set([
  "controls",
  "muted",
  "loop",
  "autoplay",
  "playsinline",
  "allowfullscreen",
]);

/**
 * Recognize a single `<video>` or `<iframe>` element. Returns null for anything else — including
 * a `<video>` with `<source>` children, which has no single `src` to render and is better shown
 * as source than approximated.
 */
export function parseMediaElement(raw: string): MediaElement | null {
  const text = raw.trim();
  const open = text.match(/^<(video|iframe)\b([^>]*?)\/?>/i);
  if (!open) return null;
  const tag = open[1].toLowerCase() as "video" | "iframe";

  // Only a bare element: `<video …></video>`, `<video … />`, or `<iframe …></iframe>`. Children
  // (a <source> list, a fallback message) mean there's more here than we can render.
  const rest = text.slice(open[0].length).trim();
  if (rest !== "" && rest.toLowerCase() !== `</${tag}>`) return null;

  const attrs = open[2] ?? "";
  const value = (name: string) =>
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ??
    attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"))?.[1];

  const src = value("src");
  if (!src || !isSafeMediaUrl(src)) return null;

  const flags: string[] = [];
  for (const m of attrs.matchAll(/\b([A-Za-z]+)(?=\s|$)/g)) {
    const name = m[1].toLowerCase();
    // A bare word that isn't followed by `=` is a boolean attribute.
    if (BOOLEAN_ATTRS.has(name) && !new RegExp(`\\b${m[1]}\\s*=`).test(attrs)) flags.push(name);
  }

  return {
    tag,
    src,
    className: value("className") ?? value("class"),
    title: value("title"),
    poster: value("poster"),
    flags,
  };
}
