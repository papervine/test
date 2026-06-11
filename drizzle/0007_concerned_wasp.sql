CREATE TABLE "github_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "github_installation_id" integer;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "last_synced_commit_sha" text;--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "githubInstallation_organizationId_idx" ON "github_installation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "site_repo_idx" ON "site" USING btree ("repo_owner","repo_name");