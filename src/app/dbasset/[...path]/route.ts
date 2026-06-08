import { promises as fs } from "node:fs";
import path from "node:path";
import type { NextRequest } from "next/server";

/**
 * Static-asset handler for the docs repo. Images (and other assets) in a
 * the incumbent/Docbot repo are referenced by absolute path from the repo root —
 * e.g. `![](/img/hero.png)`. Those files live under DOCBOT_CONTENT, outside the
 * app, so Next won't serve them from `public/`. This route streams them from the
 * content dir; `middleware.ts` rewrites asset requests here.
 *
 * At M2 (object-storage content) this becomes a signed-URL redirect or a proxy
 * to the tenant's asset bucket, but the URL shape (/img/...) stays the same.
 */
const CONTENT_DIR = path.resolve(
  process.env.DOCBOT_CONTENT ?? path.join(process.cwd(), "content"),
);

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await params;
  const rel = parts.join("/");

  // Resolve under CONTENT_DIR and reject any traversal outside it.
  const target = path.normalize(path.join(CONTENT_DIR, rel));
  if (target !== CONTENT_DIR && !target.startsWith(CONTENT_DIR + path.sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await fs.readFile(target);
    const type =
      CONTENT_TYPES[path.extname(target).toLowerCase()] ??
      "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
