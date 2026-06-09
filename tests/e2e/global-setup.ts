import { execSync } from "node:child_process";
import postgres from "postgres";

// E2E runs against a dedicated `papervine_test` database, rebuilt from the **committed
// migrations** (drizzle/) on every run — so the suite is deterministic AND the
// migrations themselves are exercised (a broken migration fails e2e). Pure DB/CLI
// ops, no app imports.
const HOST = "127.0.0.1:5432";
const ADMIN_URL = `postgres://papervine:papervine@${HOST}/postgres`;
export const TEST_DB_URL = `postgres://papervine:papervine@${HOST}/papervine_test`;

export default async function globalSetup() {
  // 1. Create the test database if it doesn't exist.
  const admin = postgres(ADMIN_URL, { max: 1 });
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = 'papervine_test'`;
  if (exists.length === 0) await admin`CREATE DATABASE papervine_test`;
  await admin.end();

  // 2. Clean slate — drop the tables AND drizzle's migration journal, which lives in
  // a separate `drizzle` schema (leaving it makes migrate think 0000 is already
  // applied → no tables). Separate statements: postgres.js won't run a multi-
  // statement string. The app hasn't connected yet at this point.
  const db = postgres(TEST_DB_URL, { max: 1 });
  await db.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await db.unsafe("CREATE SCHEMA public");
  await db.end();

  // 3. Apply the committed migrations (drizzle.config reads DATABASE_URL). Strip the
  // unpooled vars so the config falls through to this test URL, not a stray prod one.
  const env: Record<string, string | undefined> = { ...process.env, DATABASE_URL: TEST_DB_URL };
  delete env.DATABASE_URL_UNPOOLED;
  delete env.POSTGRES_URL_NON_POOLING;
  execSync("node node_modules/drizzle-kit/bin.cjs migrate", {
    env: env as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
}
