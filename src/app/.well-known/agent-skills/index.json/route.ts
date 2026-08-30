import { type NextRequest } from "next/server";
import { handleAgentSkillsIndex } from "@/lib/skills-route";

// agent-skills 0.2.0 discovery: every public skill, each with a sha256 digest so an agent can
// verify what it fetched.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleAgentSkillsIndex(req);
}
