import { type NextRequest } from "next/server";
import { handleSkillBySlug } from "@/lib/skills-route";

// The same skill, at the path the older discovery index advertises (lowercase filename).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  return handleSkillBySlug(req, name);
}
