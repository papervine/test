ALTER TABLE "site" ADD COLUMN "assistant_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "assistant_captcha_enabled" boolean DEFAULT true NOT NULL;