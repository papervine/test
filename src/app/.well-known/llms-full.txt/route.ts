import { type NextRequest } from "next/server";
import { handleLlmsRequest } from "@/lib/llms-route";

// `/.well-known/llms-full.txt` — the well-known alias for the whole-corpus variant.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleLlmsRequest(req, true);
}
