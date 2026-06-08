import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/app-schema.ts"],
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
