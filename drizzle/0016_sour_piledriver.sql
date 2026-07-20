ALTER TABLE "automation_run" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "automation_run" ADD COLUMN "changed_files" jsonb;