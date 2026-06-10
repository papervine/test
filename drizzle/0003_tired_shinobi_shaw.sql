ALTER TABLE "site" ADD COLUMN "custom_domain_subpath" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "custom_domain_verified_at" timestamp;