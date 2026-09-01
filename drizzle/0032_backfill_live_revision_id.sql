-- Repair deployment rows written between the revision columns landing and the fix that
-- actually populated `deployment.revision_id` (SPEC §10.11).
--
-- Those deploys set `site.live_revision_id` correctly — the right content was always served —
-- but never stamped the same id onto the deployment row that produced it. `canRollBack` reads
-- the deployment row, so the Roll back button never appeared on any real deploy.
--
-- The match is provably safe rather than a guess: a deployment id equals the revision id it
-- built, so a row whose id IS its site's current `live_revision_id` demonstrably produced the
-- tree being served right now. Anything else is left alone — a pre-revision deploy has no tree
-- to point at, and inventing one would offer a restore that empties the site.
UPDATE "deployment" d
SET "revision_id" = d."id"
FROM "site" s
WHERE s."id" = d."site_id"
  AND s."live_revision_id" = d."id"
  AND d."revision_id" IS NULL;
