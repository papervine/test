// The skill.md generation task (SPEC §9.1) — the executor half of the sweep.
//
// The hourly cron decides WHO is due (a cheap query over `skill_stale_at` /
// `skill_fingerprint`); this does the work for one site. Split that way because the two halves
// have completely different shapes: the decision is a few milliseconds of SQL, and the work is a
// model call that reads a whole corpus. Doing both inline in the cron route meant ten of those
// serially against a 300s serverless budget, which is a ceiling you hit rather than a limit you
// respect — and a site that kept landing late in the batch would starve.
//
// Imports are relative (no @/ alias) and the build stubs `server-only` + `next/cache` (see
// trigger.config.ts), so the Next-tangled content stack loads in plain Node.
import { logger, task } from "@trigger.dev/sdk/v3";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { site as siteTable } from "../lib/db/app-schema";
import { generateSkillForSite, SKILL_GENERATE_TASK_ID } from "../lib/skill-generate";

export const skillGenerateTask = task({
  id: SKILL_GENERATE_TASK_ID,
  // One model call over one site's page list. Generous rather than tight: the point of moving
  // off the cron route was to stop working against a ceiling.
  maxDuration: 900,
  // No automatic retry, deliberately. A failure leaves `skill_stale_at` set, so the next hourly
  // sweep re-enqueues — an hour of backoff for free, and no risk of two model calls racing to
  // write the same object because a first attempt was merely slow.
  retry: { maxAttempts: 1 },
  run: async (payload: { siteId: string; force?: boolean }) => {
    const [row] = await db
      .select()
      .from(siteTable)
      .where(eq(siteTable.id, payload.siteId))
      .limit(1);

    if (!row) {
      // Deleted between the sweep selecting it and this running. Not an error.
      logger.log("site is gone — nothing to generate", { siteId: payload.siteId });
      return { status: "skipped", reason: "missing" };
    }

    const result = await generateSkillForSite(row, { force: payload.force });
    logger.log("skill generation finished", { slug: row.slug, ...result });
    return result;
  },
});
