CREATE TABLE "domain_removal" (
	"domain" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "domainRemoval_createdAt_idx" ON "domain_removal" USING btree ("created_at");