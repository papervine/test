CREATE TABLE "slack_workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"bot_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"installed_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_workspace_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "slack_workspace" ADD CONSTRAINT "slack_workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_workspace" ADD CONSTRAINT "slack_workspace_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slackWorkspace_organizationId_idx" ON "slack_workspace" USING btree ("organization_id");