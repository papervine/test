ALTER TABLE "site" ADD COLUMN "auth_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "auth_config" jsonb;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "auth_secret_enc" text;