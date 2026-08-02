ALTER TABLE "site" ADD COLUMN "widget_id" text;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "widget_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD COLUMN "widget_allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_widget_id_unique" UNIQUE("widget_id");