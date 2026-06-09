import { execSync } from "node:child_process";
import postgres from "postgres";

// E2E runs against a dedicated `docbot_test` database so it never touches dev data.
// This runs once before the suite: create the DB if needed, apply the Drizzle schema,
// and truncate every table for a clean slate. Pure DB/CLI ops — no app imports (which
// would pull in Next-coupled modules). The seeded user is created via the real signup
// flow in auth.setup.ts.
const HOST = "127.0.0.1:5432";
const ADMIN_URL = `postgres://docbot:docbot@${HOST}/postgres`;
export const TEST_DB_URL = `postgres://docbot:docbot@${HOST}/docbot_test`;

const TABLES = [
  '"user"',
  "session",
  "account",
  "verification",
  "organization",
  "member",
  "invitation",
  "site",
  "deployment",
  "analytics_event",
];

export default async function globalSetup() {
  // 1. Create the test database if it doesn't exist.
  const admin = postgres(ADMIN_URL, { max: 1 });
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = 'docbot_test'`;
  if (exists.length === 0) await admin`CREATE DATABASE docbot_test`;
  await admin.end();

  // 2. Apply the schema (drizzle.config reads DATABASE_URL).
  execSync("node node_modules/drizzle-kit/bin.cjs push --force", {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });

  // 3. Truncate everything for a deterministic run.
  const db = postgres(TEST_DB_URL, { max: 1 });
  await db.unsafe(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  await db.end();
}
