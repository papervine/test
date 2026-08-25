import { slugify } from "@/lib/slug";

// Uploading media into a site's own storage, kept pure so every rule that decides what may be
// uploaded and where it lands is unit-testable — no S3, no DB, no browser.
//
// The bytes go to object storage under a DRAFT-scoped prefix, never to the live prefix: an upload
// is an edit, and nothing is live until Publish. `draft_file` still gets a row (with `binary` set)
// so the change list, per-file revert and discard-all keep working without knowing that some
// changes are bytes rather than text.

/** Where a session's uploaded-but-unpublished bytes live. Mirrors the live `sites/{id}/` layout
 *  so publishing is a copy with the prefix swapped. */
export function draftAssetPrefix(sessionId: string): string {
  return `drafts/${sessionId}/`;
}

export function draftAssetKey(sessionId: string, path: string): string {
  return draftAssetPrefix(sessionId) + path;
}

export type UploadKind = "video" | "image";

/**
 * What each kind accepts. The extension list is the allowlist — not the MIME type the browser
 * reports, which is client-supplied and trivially wrong (or absent, for a file dragged from an
 * unusual filesystem). The extension is also what decides the stored content type downstream via
 * `mimeForPath`, so agreeing on it here keeps one source of truth.
 */
export const UPLOAD_KINDS: Record<
  UploadKind,
  { dir: string; extensions: string[]; maxBytes: number; label: string }
> = {
  video: {
    dir: "videos",
    // The two formats every current browser plays natively. Anything else would upload fine and
    // then fail to play for some readers, which is worse than refusing it here.
    extensions: ["mp4", "webm"],
    maxBytes: 200 * 1024 * 1024,
    label: "MP4 or WebM, up to 200MB",
  },
  image: {
    dir: "images",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"],
    maxBytes: 20 * 1024 * 1024,
    label: "PNG, JPEG, GIF, WebP, AVIF or SVG, up to 20MB",
  },
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/** Refuse before uploading, so the failure arrives in the dialog rather than as a broken page. */
export function validateUpload(
  kind: UploadKind,
  filename: string,
  size: number,
): { ok: true } | { error: string } {
  const spec = UPLOAD_KINDS[kind];
  const ext = extensionOf(filename);
  if (!ext) return { error: "That file has no extension, so its type can't be determined." };
  if (!spec.extensions.includes(ext)) {
    return { error: `.${ext} isn't supported here — use ${spec.label}.` };
  }
  if (size <= 0) return { error: "That file is empty." };
  if (size > spec.maxBytes) {
    return { error: `That file is ${mb(size)}MB — the limit is ${mb(spec.maxBytes)}MB.` };
  }
  return { ok: true };
}

const mb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/**
 * The repo-relative path an upload lands at: `videos/my-clip.mp4`.
 *
 * The name is slugified because it becomes part of a URL in someone's published docs — spaces and
 * `#` in an object key are a lifetime of quoting bugs. `taken` is passed in rather than looked up
 * so this stays pure; a collision gets a numeric suffix instead of overwriting a file the author
 * may still be using elsewhere on the site.
 */
export function uploadTargetPath(
  kind: UploadKind,
  filename: string,
  taken: Iterable<string> = [],
): string | null {
  const spec = UPLOAD_KINDS[kind];
  const ext = extensionOf(filename);
  if (!spec.extensions.includes(ext)) return null;

  const base = (filename.split(/[\\/]/).pop() ?? "").replace(/\.[^.]+$/, "");
  // A name that slugifies to nothing (all punctuation, or another script) still needs a filename.
  const stem = slugify(base) || kind;

  const used = new Set(taken);
  let candidate = `${spec.dir}/${stem}.${ext}`;
  for (let n = 2; used.has(candidate); n++) candidate = `${spec.dir}/${stem}-${n}.${ext}`;
  return candidate;
}

/**
 * Pull the useful part out of an S3/MinIO error body. Both answer a failed PUT with XML naming
 * the cause — `SignatureDoesNotMatch`, `RequestTimeTooSkewed`, `EntityTooLarge` — and showing that
 * instead of a bare status is the difference between a fixable report and "it doesn't work".
 */
export function parseStorageError(body: string): string | null {
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = body.match(/<Message>([^<]+)<\/Message>/)?.[1];
  if (code && message) return `${code}: ${message}`;
  if (code) return code;
  // Not XML (a proxy's HTML error page, say) — a short excerpt still beats nothing.
  const text = body.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 200) : null;
}

/**
 * Why an upload never got a response at all.
 *
 * A rejected `fetch` is the failure mode with the least information attached: browsers report a
 * blocked cross-origin request as a bare `TypeError: Failed to fetch` on purpose, so the only way
 * to be useful is to name the two things it actually means and say where the request was headed.
 */
export function uploadThrewMessage(error: unknown, endpoint: string | null): string {
  const raw = error instanceof Error ? error.message : String(error);
  const where = endpoint ? ` (${endpoint})` : "";
  if (/failed to fetch|networkerror|network error|load failed/i.test(raw)) {
    return (
      `Couldn't reach the storage endpoint${where}. ` +
      "That usually means the bucket is missing CORS for this site's origin, or storage isn't running."
    );
  }
  return `Upload failed: ${raw}`;
}

/** The origin an upload URL points at, for an error message. Null if it isn't a usable URL. */
export function storageOrigin(uploadUrl: string): string | null {
  try {
    return new URL(uploadUrl).origin;
  } catch {
    return null;
  }
}

/** Does this path look like media of the given kind? Used to filter what the picker lists. */
export function isUploadKindPath(kind: UploadKind, path: string): boolean {
  return UPLOAD_KINDS[kind].extensions.includes(extensionOf(path));
}

/**
 * The files the picker offers, newest-looking first. Draft entries shadow published ones at the
 * same path — the picker should show what the page would use today, which for a re-upload is the
 * draft copy. Deletions in the draft hide the published file for the same reason.
 */
export function mergeMediaListing(
  kind: UploadKind,
  published: string[],
  draft: { path: string; deleted: boolean }[],
): string[] {
  const deleted = new Set(draft.filter((d) => d.deleted).map((d) => d.path));
  const all = new Set<string>();
  for (const p of published) if (!deleted.has(p)) all.add(p);
  for (const d of draft) if (!d.deleted) all.add(d.path);
  return [...all].filter((p) => isUploadKindPath(kind, p)).sort();
}
