ALTER TABLE "deployment" ADD COLUMN "revision_id" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "live_revision_id" text;