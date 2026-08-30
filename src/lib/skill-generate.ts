import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, isNotNull, or, isNull } from "drizzle-orm";
import { aiConfigured, aiModel, aiModelId } from "@papervine/renderer/lib/ai-model";
import { contentContext, listPageSlugs, loadPage, loadRaw } from "@papervine/renderer/lib/content";
import { db } from "./db";
import { site } from "./db/app-schema";
import { getObjectText, putObject } from "./storage";
import { s3Source } from "./s3-source";
import { GENERATED_SKILL_PATH } from "./skills";
import {
  buildSkillPrompt,
  capabilityFingerprint,
  finalizeSkill,
  shouldGenerate,
  type SkillPage,
} from "./skill-generation";
import { loadSkills } from "./skills-source";

/**
 * Generate a site's `skill.md` from its documentation.
 *
 * WHEN this runs is the whole design (SPEC §9.1): a publish only marks the site stale, and a
 * sweep decides. Generating inline on every publish would spend a model call on a typo run and
 * re-read the corpus twenty times in an afternoon to produce the same document.
 *
 * **Not metered.** This is a platform cost, not the customer's: it isn't something they asked
 * for per-run, they can't see it coming, and billing a Free site for a background job it never
 * triggered is the kind of charge that ends up in a support ticket. So no `authorizeAi` gate and
 * no `recordAiUsage` debit — deliberately, and the reason is here so nobody "fixes" it later.
 */

/**
 * OUTSIDE the synced content tree, and that placement is load-bearing.
 *
 * `skill.md` at the docs root is a file the sync manifest owns: writing there would be a content
 * change, which marks the site stale, which regenerates it, which writes there again. That is
 * the self-trigger loop `fireContentUpdateAutomations` exists to break, and this repo has
 * already paid for it once (a random dedupe key that defeated the breaker and burned toward the
 * daily cap). A dot-prefixed path outside the manifest can't be swept as stale by the sync and
 * can't be picked up as a page (`isPageSlug`), so the loop has nowhere to close.
 */
function generatedKey(siteId: string): string {
  return `sites/${siteId}/${GENERATED_SKILL_PATH}`;
}

/**
 * Read the generated file for a site, if one exists.
 *
 * Straight from storage rather than through the content source's `loadRaw`, and that is not an
 * optimisation — it's required. `loadRaw` is cached under the site's CONTENT version key
 * (`${sha}:${updatedAt}`), and generation deliberately does not bump `updatedAt` (doing so would
 * invalidate every page of a site whose pages didn't change, and would mark the site's content
 * as moved — the loop). So a regenerated file written under an unchanged version key is
 * invisible to `loadRaw` until something else changes the content: the file on disk is new and
 * every reader keeps getting the old one. Caught by regenerating twice and watching the second
 * one not appear.
 *
 * Uncached is fine here: these endpoints already carry `s-maxage=3600`, so the repeat fetches an
 * agent crawl produces are absorbed at the edge, not by this call.
 */
export async function loadGeneratedSkill(siteId: string): Promise<string | null> {
  return getObjectText(generatedKey(siteId)).catch(() => null);
}

type SiteRow = typeof site.$inferSelect;

/** What a run did, for the sweep's log and the dashboard's response. */
export type SkillRunResult =
  | { status: "generated"; fingerprint: string }
  | { status: "skipped"; reason: "authored" | "unchanged" | "no-ai" | "empty" };

/**
 * Generate for one site, if it needs it. Safe to call on any site at any time — the decision
 * lives in `shouldGenerate`, so callers don't each re-implement the policy.
 */
export async function generateSkillForSite(
  row: SiteRow,
  opts: { force?: boolean } = {},
): Promise<SkillRunResult> {
  if (!aiConfigured()) return { status: "skipped", reason: "no-ai" };

  const src = s3Source(row.id, `${row.lastSyncedCommitSha ?? ""}:${row.updatedAt.toISOString()}`);

  return contentContext.run(src, async () => {
    // An author's own file wins outright — we neither overwrite it nor publish a rival.
    const authored = await loadSkills();
    if (authored.length > 0) return { status: "skipped", reason: "authored" as const };

    const config = (await loadRaw("docs.json").catch(() => null)) ?? "";
    const slugs = await listPageSlugs().catch(() => [] as string[]);
    if (slugs.length === 0) return { status: "skipped", reason: "empty" as const };

    const fingerprint = capabilityFingerprint({ config, slugs });
    const decide = shouldGenerate({
      hasAuthoredSkill: false,
      storedFingerprint: row.skillFingerprint,
      currentFingerprint: fingerprint,
      stale: row.skillStaleAt !== null,
      force: opts.force,
    });
    if (!decide) {
      // Clear the flag even when we skip: the publish HAS been considered, and leaving it set
      // would make every future sweep re-examine a site we've already decided about.
      await clearStale(row.id, row.skillFingerprint, row.skillGeneratedAt);
      return { status: "skipped", reason: "unchanged" as const };
    }

    // Titles and descriptions are what make the prompt about this product rather than about
    // documentation in general. Read here, not in the fingerprint — see capabilityFingerprint.
    const pages: SkillPage[] = [];
    for (const slug of slugs.slice(0, 400)) {
      const page = await loadPage(slug).catch(() => null);
      if (!page) continue;
      pages.push({
        slug,
        title: typeof page.frontmatter.title === "string" ? page.frontmatter.title : "",
        description:
          typeof page.frontmatter.description === "string" ? page.frontmatter.description : "",
      });
    }

    const parsedConfig = safeJson(config);
    const docsUrl = row.customDomain
      ? `https://${row.customDomain}`
      : `https://${row.slug}.${process.env.NEXT_PUBLIC_APEX_DOMAIN ?? "papervine.io"}`;

    // A SCHEMA, not a marker line in prose. The frontmatter `description` is the sentence an
    // agent matches on to decide the skill is relevant at all, so it has to be the "Use when …"
    // trigger form rather than the site's blurb — and asking for it as a `DESCRIPTION:` line at
    // the top of a long prompt did not survive contact with the model, which started at the
    // heading every time and left us silently falling back to the blurb. Two fields the SDK
    // guarantees beat one convention the model has to remember.
    const { object } = await generateObject({
      model: aiModel(aiModelId("automations")),
      schema: z.object({
        description: z.string().describe("Use when <activity> — <trigger>, <trigger>."),
        body: z.string().describe("The Markdown body, starting at the # heading."),
      }),
      prompt: buildSkillPrompt({
        siteName: parsedConfig?.name ?? row.name,
        siteDescription: parsedConfig?.description ?? "",
        docsUrl,
        navigation: JSON.stringify(parsedConfig?.navigation ?? {}, null, 1).slice(0, 8000),
        pages,
      }),
    });

    const file = finalizeSkill({
      body: object.body,
      siteName: parsedConfig?.name ?? row.name,
      siteSlug: row.slug,
      docsUrl,
      // Still a fallback: an empty string would pass the schema and produce a skill no agent
      // ever selects.
      description:
        object.description.trim() || parsedConfig?.description || `Documentation for ${row.name}.`,
    });

    await putObject(generatedKey(row.id), file, "text/plain; charset=utf-8");
    await db
      .update(site)
      .set({ skillStaleAt: null, skillFingerprint: fingerprint, skillGeneratedAt: new Date() })
      // NOTE: `updatedAt` is deliberately NOT bumped. It's the content cache's version key, and
      // bumping it would invalidate every cached page of a site whose pages did not change —
      // and mark the site's own content as having moved, which is how the loop would start.
      .where(eq(site.id, row.id));

    return { status: "generated" as const, fingerprint };
  });
}

async function clearStale(
  id: string,
  fingerprint: string | null,
  generatedAt: Date | null,
): Promise<void> {
  await db
    .update(site)
    .set({ skillStaleAt: null, skillFingerprint: fingerprint, skillGeneratedAt: generatedAt })
    .where(eq(site.id, id));
}

function safeJson(raw: string): { name?: string; description?: string; navigation?: unknown } | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * The sweep. Picks up sites that have published since we last looked, plus sites that have never
 * been generated at all, and works through them one at a time.
 *
 * Serial and capped rather than parallel: this is background work with no one waiting on it, and
 * a burst of concurrent model calls across every tenant is the shape that turns a quiet cron
 * into an incident.
 */
export async function sweepSkillGeneration(limit = 10): Promise<{
  considered: number;
  generated: number;
  skipped: number;
}> {
  const rows = await db
    .select()
    .from(site)
    .where(
      and(
        eq(site.status, "live"),
        or(isNotNull(site.skillStaleAt), isNull(site.skillFingerprint)),
      ),
    )
    .limit(limit);

  let generated = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      const result = await generateSkillForSite(row);
      if (result.status === "generated") generated++;
      else skipped++;
    } catch (err) {
      // One site's failure must not stop the sweep — and the flag stays set, so it's retried on
      // the next run rather than silently dropped.
      console.warn(`[skills] generation failed for ${row.slug}:`, err);
      skipped++;
    }
  }
  return { considered: rows.length, generated, skipped };
}
