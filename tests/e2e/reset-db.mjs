// E2E database reset — runs as the FIRST HALF of playwright.config's webServer command,
// BEFORE the app server boots (a production build since the switch off `next dev`). It must not live in globalSetup: Playwright starts the
// webServer first, so a globalSetup rebuild drops the schema underneath the app's
// already-open connection pool and Next's warm data cache — poisoned sockets and stale
// unstable_cache entries then fail random requests for the rest of the suite. Running
// the rebuild before the server exists makes every run start from the same clean state.
//
// Rebuilds `papervine_test` from the COMMITTED migrations (drizzle/) so the suite is
// deterministic AND a broken migration fails e2e. Keep the URLs in sync with
// tests/e2e/global-setup.ts (which specs import TEST_DB_URL from).
import { execSync } from "node:child_process";
import postgres from "postgres";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { requireNoDevServer } from "../dev-lock.mjs";

// Bail BEFORE dropping the test database: the build half of the webServer command
// can't start while a dev server holds this directory, and Playwright would otherwise
// report only "Process from config.webServer was not able to start" — after this script had
// already rebuilt the DB. Reusing the dev server isn't an option; it points at the dev
// database and real integrations, not `papervine_test` with them blanked.
requireNoDevServer(process.cwd(), "the e2e suite", process.env.NEXT_DIST_DIR ?? ".next-e2e");

// Drop the DATA cache along with the database. Since the app under test is a production build,
// `unstable_cache` entries persist on disk between runs — and their TTLs outlive a run: a site
// row is cached for 60s (`SITE_ROW_TTL`) and an S3 config read for an hour, while every spec
// re-creates its fixture rows with the SAME ids and only the product's own mutations call
// `revalidateSiteRow`. A raw-SQL fixture therefore inherits whatever the last run cached about
// that id, including a null from after the previous run's afterAll deleted it — which renders as
// "this site hasn't synced any content yet" on a site whose row and content are both present.
// The suite's starting state is: fresh database, cold data cache. Only `cache/fetch-cache` goes;
// the Turbopack build cache next to it is 500MB+ and makes the build incremental, so it stays.
const distDir = process.env.NEXT_DIST_DIR ?? ".next-e2e";
await rm(join(process.cwd(), distDir, "cache", "fetch-cache"), { recursive: true, force: true });

const HOST = "127.0.0.1:5432";
const ADMIN_URL = `postgres://papervine:papervine@${HOST}/postgres`;
const TEST_DB_URL = `postgres://papervine:papervine@${HOST}/papervine_test`;

// 1. Create the test database if it doesn't exist.
const admin = postgres(ADMIN_URL, { max: 1 });
const exists = await admin`SELECT 1 FROM pg_database WHERE datname = 'papervine_test'`;
if (exists.length === 0) await admin`CREATE DATABASE papervine_test`;
// Sever any straggler connections (a leftover dev server on the test DB) so the DROP
// below can't be blocked or leave a poisoned pool behind.
await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = 'papervine_test' AND pid <> pg_backend_pid()`;
await admin.end();

// 2. Clean slate — drop the tables AND drizzle's migration journal, which lives in a
// separate `drizzle` schema (leaving it makes migrate think 0000 is already applied →
// no tables). Separate statements: postgres.js won't run a multi-statement string.
const db = postgres(TEST_DB_URL, { max: 1 });
await db.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
await db.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
await db.unsafe("CREATE SCHEMA public");
await db.end();

// 3. Apply the committed migrations (drizzle.config reads DATABASE_URL). Strip the
// unpooled vars so the config falls through to this test URL, not a stray prod one.
const env = { ...process.env, DATABASE_URL: TEST_DB_URL };
delete env.DATABASE_URL_UNPOOLED;
delete env.POSTGRES_URL_NON_POOLING;
execSync("node node_modules/drizzle-kit/bin.cjs migrate", { env, stdio: "inherit" });
console.log("[e2e] test database rebuilt from migrations");
