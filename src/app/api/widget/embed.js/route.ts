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
      // An hour in production; nothing in dev. The browser caching this script for an hour means
      // an edit to the loader is INVISIBLE for an hour on a page that already loaded it, and the
      // symptom is "my change to the widget did nothing" with no header in sight to explain it.
      "Cache-Control":
        process.env.NODE_ENV === "production" ? "public, max-age=3600" : "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
