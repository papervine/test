CREATE TABLE "waitlist_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"note" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlistEntry_email_uidx" ON "waitlist_entry" USING btree ("email");