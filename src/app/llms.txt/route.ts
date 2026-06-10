import { type NextRequest } from "next/server";
import { handleLlmsRequest } from "@/lib/llms-route";

// llms.txt index for AI clients (SPEC §9.1). Served on the tenant host (middleware lets
// it through) and on the apex/preview host. Logs the fetch as agent traffic.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleLlmsRequest(req, false);
}
