CREATE TABLE "deletion_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deletion_feedback" ADD CONSTRAINT "deletion_feedback_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletionFeedback_createdAt_idx" ON "deletion_feedback" USING btree ("created_at");