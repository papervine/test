// E2E database reset — runs as the FIRST HALF of playwright.config's webServer command,
// BEFORE `next dev` boots. It must not live in globalSetup: Playwright starts the
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
