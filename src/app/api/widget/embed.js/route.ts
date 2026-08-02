import { WIDGET_EMBED_SCRIPT } from "@/lib/widget-embed-script";

/**
 * Serves the embeddable widget's loader script (SPEC §8.7) at a URL that looks like a
 * static asset (`/api/widget/embed.js`) even though it's a route handler — this repo has
 * no `public/` folder anywhere (static tenant assets are proxied dynamically too, see
 * `/api/tenant-asset/*`), and a route handler needs no build step to serve a string
 * constant. Public and un-authenticated by design: it's the loader, not the chat call.
 */
export function GET() {
  return new Response(WIDGET_EMBED_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
