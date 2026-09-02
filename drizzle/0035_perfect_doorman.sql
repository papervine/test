CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"site_id" text NOT NULL,
	"transport" text DEFAULT 'slack' NOT NULL,
	"slack_event_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text NOT NULL,
	"slack_message_ts" text,
	"slack_user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"executor_run_id" text,
	"prompt" text NOT NULL,
	"answer" text,
	"error" text,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "agent_run_slack_event_id_unique" UNIQUE("slack_event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agentRun_site_queuedAt_idx" ON "agent_run" USING btree ("site_id","queued_at");