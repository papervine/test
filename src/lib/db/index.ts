import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as authSchema from "./schema";
import * as appSchema from "./app-schema";

const schema = { ...authSchema, ...appSchema };

// postgres.js connects lazily (first query), so importing this module without a
// live DATABASE_URL is safe — matters for the Better Auth CLI / build steps.
const client = postgres(process.env.DATABASE_URL ?? "");

export const db = drizzle(client, { schema });
