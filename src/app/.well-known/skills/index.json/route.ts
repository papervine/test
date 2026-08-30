import { type NextRequest } from "next/server";
import { handleSkillsIndex } from "@/lib/skills-route";

// The older skills discovery format, served alongside agent-skills/ because clients in the wild
// look for one or the other.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleSkillsIndex(req);
}
