import { defineConfig } from "drizzle-kit";

// Migrations/DDL prefer a direct (unpooled) connection — pgbouncer poolers (Neon's
// pooled URL) can choke on introspection. Falls back to DATABASE_URL for local
// (docker Postgres sets only that). Load the env file with `node --env-file=…`
// (not shell `source` — the Neon URL's `&` breaks sourcing).
const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  "";

export default defineConfig({
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/app-schema.ts"],
  dialect: "postgresql",
  dbCredentials: { url },
});
