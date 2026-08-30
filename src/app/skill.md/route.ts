import { type NextRequest } from "next/server";
import { handleSkillMd } from "@/lib/skills-route";

// The site's skill.md (SPEC §9.1) — what an agent reads to learn what it can DO with this
// product, as opposed to llms.txt, which tells it where to READ. Served on the tenant host
// (middleware passes it through unrewritten) and on the apex/preview host.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleSkillMd(req);
}
