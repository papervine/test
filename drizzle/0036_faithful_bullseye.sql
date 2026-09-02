CREATE TABLE "integration_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"nango_connection_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connection" ADD CONSTRAINT "integration_connection_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrationConnection_organizationId_idx" ON "integration_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrationConnection_org_provider_idx" ON "integration_connection" USING btree ("organization_id","provider");