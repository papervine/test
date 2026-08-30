ALTER TABLE "site" ADD COLUMN "skill_stale_at" timestamp;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "skill_fingerprint" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "skill_generated_at" timestamp;