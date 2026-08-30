import { type NextRequest } from "next/server";
import { handleSkillBySlug } from "@/lib/skills-route";

// One skill by the slug the agent-skills index advertises.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  return handleSkillBySlug(req, name);
}
