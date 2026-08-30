import "server-only";
import { type NextRequest } from "next/server";
import { contentContext } from "@papervine/renderer/lib/content";
import { requestContentSource, requestSiteRecord } from "./request-source";
import { logAgentVisit } from "./agent-visit";
import { loadSkillsWithGenerated } from "./skills-source";
import { agentCard, agentSkillsIndex, publicSkills, skillsIndex, type Skill } from "./skills";

/**
 * The `skill.md` agent surfaces, for whichever tenant the request's Host resolves to.
 *
 * Every one of these is unauthenticated and carries no reader session — exactly like
 * `/llms.txt` and the embeddable widget — so they serve the PUBLIC subset only. A skill with
 * `groups:` never appears in a manifest, in the agent card, or at its own URL.
 *
 * Cached at the edge rather than per-render: the response is identical for every caller (it is
 * always the anonymous subset), and agents crawling a discovery surface produce exactly the
 * repeat-fetch pattern a CDN exists to absorb.
 */
const CACHE = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

const SKILL_CONTENT_TYPE = "text/markdown; charset=utf-8";

/** Resolve the tenant, read its skills, and hand them to `render` inside the content context. */
async function withSkills<T>(fn: (skills: Skill[]) => T | Promise<T>): Promise<T | null> {
  const src = await requestContentSource();
  // The site id is what lets the generated fallback be read: it lives outside the content tree,
  // so it is addressed by site rather than through the content source. Null on the apex/preview,
  // where there is no tenant and nothing was generated.
  const record = await requestSiteRecord().catch(() => null);
  const run = async () => publicSkills(await loadSkillsWithGenerated(record?.id ?? null));
  try {
    const skills = src ? await contentContext.run(src, run) : await run();
    return await fn(skills);
  } catch {
    return null;
  }
}

const notFound = () => new Response("Not found", { status: 404 });

const json = (body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": CACHE },
  });

/**
 * `GET /skill.md`.
 *
 * With one skill this serves the file. With several there is no single file to serve, so it
 * redirects to the discovery index rather than picking one arbitrarily or concatenating them
 * into a document that matches no spec.
 */
export async function handleSkillMd(req: NextRequest): Promise<Response> {
  const res = await withSkills((skills) => {
    if (skills.length === 0) return notFound();
    if (skills.length > 1) {
      return Response.redirect(new URL("/.well-known/agent-skills/index.json", req.url), 307);
    }
    return new Response(skills[0].raw, {
      headers: { "content-type": SKILL_CONTENT_TYPE, "cache-control": CACHE },
    });
  });
  if (res) logAgentVisit(req, "/skill.md");
  return res ?? notFound();
}

/** `GET /.well-known/agent-skills/index.json` — the 0.2.0 discovery document, with digests. */
export async function handleAgentSkillsIndex(req: NextRequest): Promise<Response> {
  const res = await withSkills((skills) => json(agentSkillsIndex(skills)));
  if (res) logAgentVisit(req, "/.well-known/agent-skills/index.json");
  return res ?? notFound();
}

/** `GET /.well-known/skills/index.json` — the older discovery format. */
export async function handleSkillsIndex(req: NextRequest): Promise<Response> {
  const res = await withSkills((skills) => json(skillsIndex(skills)));
  if (res) logAgentVisit(req, "/.well-known/skills/index.json");
  return res ?? notFound();
}

/** One skill by its slug — the target of both indexes' per-skill URLs. */
export async function handleSkillBySlug(req: NextRequest, slug: string): Promise<Response> {
  const res = await withSkills((skills) => {
    const skill = skills.find((s) => s.slug === slug);
    // 404 rather than a list: a slug that isn't public and a slug that doesn't exist must be
    // indistinguishable, or the response confirms a gated skill is there.
    if (!skill) return notFound();
    return new Response(skill.raw, {
      headers: { "content-type": SKILL_CONTENT_TYPE, "cache-control": CACHE },
    });
  });
  if (res) logAgentVisit(req, `/.well-known/agent-skills/${slug}/SKILL.md`);
  return res ?? notFound();
}

/**
 * `GET /.well-known/agent-card.json` — an A2A 0.3 card, so a client can discover the site and
 * everything it exposes in one request instead of walking the endpoints above.
 */
export async function handleAgentCard(req: NextRequest): Promise<Response> {
  const host = req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "";

  const src = await requestContentSource();
  const record = await requestSiteRecord().catch(() => null);
  const build = async () => {
    const config = await (src ?? null)?.loadConfig();
    const skills = publicSkills(await loadSkillsWithGenerated(record?.id ?? null));
    return agentCard({
      origin,
      title: config?.name ?? host,
      description: config?.description ?? "",
      skills,
    });
  };

  try {
    const card = src ? await contentContext.run(src, build) : await build();
    logAgentVisit(req, "/.well-known/agent-card.json");
    return json(card);
  } catch {
    return notFound();
  }
}
