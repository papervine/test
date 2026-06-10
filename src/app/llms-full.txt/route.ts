import { type NextRequest } from "next/server";
import { handleLlmsRequest } from "@/lib/llms-route";

// llms-full.txt — the llms.txt index plus every page's full Markdown body (SPEC §9.1).
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleLlmsRequest(req, true);
}
