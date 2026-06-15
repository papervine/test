CREATE TABLE "draft_file" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editor_session" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"branch" text NOT NULL,
	"base_branch" text NOT NULL,
	"base_commit_sha" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_file" ADD CONSTRAINT "draft_file_session_id_editor_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."editor_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_session" ADD CONSTRAINT "editor_session_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_session" ADD CONSTRAINT "editor_session_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draftFile_session_path_idx" ON "draft_file" USING btree ("session_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "editorSession_site_branch_idx" ON "editor_session" USING btree ("site_id","branch");