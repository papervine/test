CREATE TABLE "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"catalog_key" text NOT NULL,
	"name" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger_type" text NOT NULL,
	"cron_expression" text,
	"executor_schedule_id" text,
	"trigger_repos" jsonb,
	"context_repos" jsonb,
	"apply_mode" text DEFAULT 'review' NOT NULL,
	"additional_prompt" text,
	"extras" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"site_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_ref" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"executor_run_id" text,
	"result_ref" text,
	"summary" text,
	"error" text,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_siteId_idx" ON "automation" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_site_catalog_uidx" ON "automation" USING btree ("site_id","catalog_key") WHERE "automation"."catalog_key" != 'custom';--> statement-breakpoint
CREATE INDEX "automationRun_site_queuedAt_idx" ON "automation_run" USING btree ("site_id","queued_at");--> statement-breakpoint
CREATE INDEX "automationRun_automation_queuedAt_idx" ON "automation_run" USING btree ("automation_id","queued_at");