import { type NextRequest } from "next/server";
import { handleAgentCard } from "@/lib/skills-route";

// A2A 0.3 agent card — the site and all of its skills in a single request, for clients that
// discover by card rather than by walking the skills endpoints.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleAgentCard(req);
}
