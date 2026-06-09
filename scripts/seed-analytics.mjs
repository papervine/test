// Seed realistic analytics events for local dev / demos (SPEC §10.1). Pure DB ops,
// no app imports (mirrors tests/e2e/global-setup.ts). Run:
//   node --env-file=.env.local scripts/seed-analytics.mjs [siteSlug]
// Defaults to the first site if no slug is given. Idempotent-ish: clears this site's
// existing events first so re-running doesn't pile up.
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
const slug = process.argv[2];

const DAYS = 8; // last 8 day-buckets, today included (partial)
const now = new Date();

// Page view counts → drives Top pages ordering + Views total.
const PAGES = [
  ["/", 74],
  ["/recommended-reading", 17],
  ["/guides/getting-started", 16],
  ["/features/overview", 11],
  ["/features/user-roles", 9],
  ["/glossary", 7],
  ["/api-reference/assets/list-assets", 7],
  ["/features/quickstart", 6],
  ["/features/work-requests/automated-localization", 5],
  ["/features/projects/overview", 5],
  ["/features/faq", 5],
  ["/features/work-requests", 5],
  ["/features/assets/overview", 4],
  ["/guides/uploading-assets", 4],
  ["/api-reference/introduction", 3],
  ["/features/projects/creating-a-project", 3],
  ["/changelog", 2],
];

const SEARCHES = [
  "user roles", "download assets", "api key", "create project", "webhooks",
  "localization", "billing", "sso", "rate limits",
];
const QUESTIONS = [
  "How do I invite a teammate?",
  "What file formats can I upload?",
  "How does automated localization work?",
  "Can I use a custom domain?",
  "How do I rotate an API key?",
];

// Weight recent days more heavily; today (offset 0) is partial.
function pickDayOffset() {
  const weights = [3, 5, 6, 4, 2, 1, 1, 1]; // offset 0..7 (0 = today)
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    if ((r -= weights[i]) < 0) return i;
  }
  return 0;
}

function timeOnDay(offset) {
  const d = new Date(now);
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  const span = offset === 0 ? now.getTime() - d.getTime() : 86_400_000;
  return new Date(d.getTime() + Math.random() * span);
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Pre-assign each visitor a "primary day" so daily distinct-visitor counts (the
// chart) look organic, not uniform noise.
function makeVisitors(n) {
  return Array.from({ length: n }, () => ({
    id: randomUUID(),
    day: pickDayOffset(),
  }));
}

function row(siteId, e) {
  return {
    id: randomUUID(),
    site_id: siteId,
    type: e.type,
    source: e.source ?? "human",
    path: e.path ?? null,
    referrer: e.referrer ?? null,
    query: e.query ?? null,
    status: e.status ?? null,
    session_id: e.sessionId ?? null,
    created_at: e.createdAt,
  };
}

function buildEvents(siteId) {
  const rows = [];
  const humans = makeVisitors(27);

  // Human page views — each view belongs to a visitor (clustered on their day).
  for (const [path, count] of PAGES) {
    for (let i = 0; i < count; i++) {
      const v = pick(humans);
      rows.push(
        row(siteId, {
          type: "page_view",
          source: "human",
          path,
          referrer: Math.random() < 0.85 ? "$direct" : "docs.pixwel.com",
          sessionId: v.id,
          createdAt: timeOnDay(v.day),
        }),
      );
    }
  }

  // Human searches + assistant queries.
  for (let i = 0; i < 9; i++) {
    const v = pick(humans);
    rows.push(
      row(siteId, {
        type: "search",
        source: "human",
        query: pick(SEARCHES),
        sessionId: v.id,
        createdAt: timeOnDay(v.day),
      }),
    );
  }
  for (let i = 0; i < 5; i++) {
    const v = pick(humans);
    rows.push(
      row(siteId, {
        type: "assistant",
        source: "human",
        query: pick(QUESTIONS),
        status: "answered",
        sessionId: v.id,
        createdAt: timeOnDay(v.day),
      }),
    );
  }

  // Agent traffic (the Agents toggle) — MCP/crawler reads, smaller volume.
  const agents = makeVisitors(8);
  for (let i = 0; i < 90; i++) {
    const v = pick(agents);
    rows.push(
      row(siteId, {
        type: "page_view",
        source: "agent",
        path: pick(PAGES)[0],
        referrer: "$direct",
        sessionId: v.id,
        createdAt: timeOnDay(v.day),
      }),
    );
  }
  for (let i = 0; i < 22; i++) {
    const v = pick(agents);
    rows.push(
      row(siteId, {
        type: "search",
        source: "agent",
        query: pick(SEARCHES),
        sessionId: v.id,
        createdAt: timeOnDay(v.day),
      }),
    );
  }

  return rows;
}

const [target] = slug
  ? await sql`select id, slug, name from site where slug = ${slug} limit 1`
  : await sql`select id, slug, name from site order by created_at limit 1`;

if (!target) {
  console.error(slug ? `No site with slug "${slug}".` : "No sites found.");
  await sql.end();
  process.exit(1);
}

await sql`delete from analytics_event where site_id = ${target.id}`;
const rows = buildEvents(target.id);
for (let i = 0; i < rows.length; i += 500) {
  await sql`insert into analytics_event ${sql(rows.slice(i, i + 500))}`;
}

console.log(
  `Seeded ${rows.length} events for "${target.name}" (${target.slug}) over the last ${DAYS} days.`,
);
await sql.end();
