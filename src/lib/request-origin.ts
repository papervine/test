import { headers } from "next/headers";
import { originFromHost } from "@papervine/renderer/lib/origin";

/**
 * The absolute origin the CURRENT request was made to, for `metadataBase` (see
 * `@papervine/renderer/lib/origin` for why it must come from the request rather than config).
 * Null when the Host header is missing or unusable.
 */
export async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  // A custom domain is rewritten internally, so middleware forwards the real vanity host —
  // prefer it, since that's the origin the reader (and the crawler) actually sees.
  return originFromHost(h.get("x-papervine-host") ?? h.get("host"), h.get("x-forwarded-proto"));
}
