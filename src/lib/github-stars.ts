// Star count for the public repo, shown on the marketing hero's GitHub button.
//
// Deliberately NOT `server-only`: nothing here touches a secret or the DB, and keeping it
// importable everywhere means the button can move without dragging an import boundary with it.

/** The public repo the home page links to. Same one the header/footer point at. */
const REPO = "papervine/papervine";

/**
 * The repo's star count, or null when it can't be had.
 *
 * Null is an ordinary answer, not an error: the button renders without a number and still
 * links to GitHub. That matters because this is the ONE thing on the landing page that
 * depends on a third party being up, and the page is the SEO surface — a rate-limited or slow
 * api.github.com must never be able to slow it down, let alone fail it.
 *
 * Three guards, each for a different failure:
 *  - `revalidate` puts it in Next's Data Cache, so a deployment makes at most one call an hour
 *    rather than one per visitor. Unauthenticated GitHub allows 60/hr per IP, which a busy
 *    landing page would burn through in seconds.
 *  - a 2s `AbortSignal.timeout` caps the worst case, because "slow" hurts more here than
 *    "missing" — the count is decoration and the page is not.
 *  - try/catch swallows the rest (offline CI, DNS, a shape change in the response).
 */
export async function githubStars(): Promise<number | null> {
  // Single-repo preview mode (`papervine dev`, and the smoke gate) skips the call outright.
  // Those runs want a hermetic page with no outbound dependency, and a decorative count is
  // worth nothing there — the gate timed out on `/home` once already while this sat on the
  // render path. Same short-circuit shape the tenant lookups use for the DB.
  if (process.env.PAPERVINE_CONTENT) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "papervine",
        // Raises the rate limit where a token happens to be configured; absent is fine.
        ...(process.env.GITHUB_TOKEN
          ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const stars = (data as { stargazers_count?: unknown }).stargazers_count;
    return typeof stars === "number" ? stars : null;
  } catch {
    return null;
  }
}

/** 1234 → "1.2k". GitHub's own rendering, and it keeps the button width stable as we grow. */
export function formatStars(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
}
