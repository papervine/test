/**
 * The "Powered by Papervine" badge on a tenant's docs site.
 *
 * In the flow of the page, right-aligned under the content, rather than a `position: fixed`
 * corner sticker. Two reasons: a fixed badge sits on top of whatever the reader is reading and
 * follows them down every page, which is a heavier tax on a customer's site than the attribution
 * is worth; and the assistant is a full-height right-hand drawer here, so a fixed badge in that
 * corner would be half-covered whenever it's open.
 *
 * Deliberately quiet — muted, small, and it only reaches full contrast on hover. It's
 * attribution, not an advertisement on someone else's documentation.
 *
 * `pv-no-print` because a printed page shouldn't carry it, matching the assistant drawer.
 *
 * Text only, no mark. The brand logo exists in this repo as a PNG and nothing else, and pulling
 * an image from our origin onto a customer's page is a request they didn't ask for — and a
 * third-party host their CSP may well refuse. Add the mark here when there's an inline SVG of
 * it to add; a hand-approximated path is worse than no logo.
 */
export function PoweredBy() {
  return (
    <div className="pv-no-print mx-auto flex max-w-[var(--db-shell-w)] justify-end px-6 pb-10 pt-6">
      <a
        href="https://papervine.io/?ref=docs-badge"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        Powered by Papervine
      </a>
    </div>
  );
}
