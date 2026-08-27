import { type NextRequest } from "next/server";
import { handleLlmsRequest } from "@/lib/llms-route";

// `/.well-known/llms.txt` — the RFC 8615 location some AI clients probe first. Same body as
// the root `/llms.txt`; two paths rather than a redirect, because a client that follows no
// redirects still gets the index.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleLlmsRequest(req, false);
}
