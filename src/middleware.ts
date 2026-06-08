import { NextResponse, type NextRequest } from "next/server";

/**
 * Docs assets (images, fonts, video) are referenced by absolute path from the
 * repo root — e.g. `/img/hero.png`, `/logo/dark.svg`. Without this, those
 * requests fall through to the `[[...slug]]` page route, find no MDX file, and
 * 404 (broken images). We rewrite any request that ends in a static-asset
 * extension to the `dbasset` handler, which streams it from DOCBOT_CONTENT.
 */
const ASSET_RE =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|mp4|webm|pdf|woff2?)$/i;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (ASSET_RE.test(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = `/dbasset${pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals; everything else is checked against ASSET_RE above.
  matcher: ["/((?!_next/|dbasset/).*)"],
};
