import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, isNotNull, or, isNull } from "drizzle-orm";
import { aiConfigured, aiModel, aiModelId } from "@papervine/renderer/lib/ai-model";
import { contentContext, listPageSlugs, loadPage, loadRaw } from "@papervine/renderer/lib/content";
import { db } from "./db";
import { putObject } from "./storage";
import { site } from "./db/app-schema";
import { s3Source } from "./s3-source";
import { contentVersion, liveContentPrefix } from "./revisions";
import { isExecutorConfigured } from "./automations/executor";
import {
  buildSkillPrompt,
  capabilityFingerprint,
  finalizeSkill,
  shouldGenerate,
  type SkillPage,
} from "./skill-generation";
import { generatedSkillKey, loadSkills } from "./skills-source";

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

  const src = s3Source(row.id, contentVersion(row), liveContentPrefix(row));

  return contentContext.run(src, async () => {
    // An author's own file wins outright — we neither overwrite it nor publish a rival.
    // The source is passed EXPLICITLY: the sweep's inline path calls this once per site inside a
    // single request, where the ambient helpers' arg-keyed memoization would hand site B the
    // answer it computed for site A.
    const authored = await loadSkills(src);
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

    await putObject(generatedSkillKey(row.id), file, "text/plain; charset=utf-8");
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

/** The Trigger.dev task that generates for one site (src/trigger/skill-generate.ts). */
export const SKILL_GENERATE_TASK_ID = "skill-generate";

/** How many sites the inline fallback will do in one request — that path has the ceiling. */
const INLINE_CAP = 5;

/**
 * Hand one site to the executor, or generate it here when there is no executor.
 *
 * Shared by the hourly sweep and the operator console's Regenerate button so the two can't drift
 * on the thing that matters: whether a run is queued or done inline, and how it's deduped.
 * Returns true when it was queued, false when it ran inline.
 */
export async function enqueueSkillGeneration(
  row: SiteRow,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  if (!isExecutorConfigured()) {
    await generateSkillForSite(row, opts);
    return false;
  }

  const { tasks } = await import("@trigger.dev/sdk/v3");
  await tasks.trigger(
    SKILL_GENERATE_TASK_ID,
    { siteId: row.id, force: opts.force },
    {
      // Keyed on the staleness EPISODE, not just the site: two sweeps overlapping while a
      // generation is still running must not queue the same work twice. Same shape as the
      // automation fan-out's `ref` — and, like it, stable for the episode rather than freshly
      // random, which is the bug that once defeated that breaker.
      //
      // A forced run is the deliberate exception, and it is not the same mistake: an operator
      // pressing Regenerate twice means "do it again", so that key carries a timestamp. The rule
      // is that a key must be stable for the EVENT it represents — for the sweep the event is a
      // publish, for this it is the press.
      idempotencyKey: opts.force
        ? `skill:${row.id}:force:${Date.now()}`
        : `skill:${row.id}:${row.skillStaleAt?.toISOString() ?? "initial"}`,
    },
  );
  return true;
}

/**
 * The sweep: decide WHO is due, and hand each one to the executor.
 *
 * Only the decision lives here — a few milliseconds of SQL. The work is a model call over a
 * whole corpus, and doing ten of those serially inside the cron route meant running at a 300s
 * serverless ceiling, where a site that kept landing late in the batch would never get its turn.
 * On the task queue each generation gets its own budget, its own retry, and its own run record;
 * a failure here is a `console.warn` in a log nobody reads.
 *
 * With no executor configured (local dev without TRIGGER_SECRET_KEY) it generates inline
 * instead, so the cron route stays runnable on its own — with a smaller cap, because that path
 * *is* the one with the ceiling.
 */
export async function sweepSkillGeneration(limit = 25): Promise<{
  considered: number;
  enqueued: number;
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

  const executor = isExecutorConfigured();
  let enqueued = 0;
  let generated = 0;
  let skipped = 0;

  for (const row of rows.slice(0, executor ? rows.length : INLINE_CAP)) {
    try {
      if (await enqueueSkillGeneration(row)) enqueued++;
      else generated++;
    } catch (err) {
      // One site's failure must not stop the sweep — and the flag stays set, so it's picked up
      // on the next run rather than silently dropped.
      console.warn(`[skills] generation failed for ${row.slug}:`, err);
      skipped++;
    }
  }
  return { considered: rows.length, enqueued, generated, skipped };
}
