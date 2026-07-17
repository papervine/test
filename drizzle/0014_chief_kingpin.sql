CREATE TABLE "billing_customer" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customer_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "billing_plan" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"stripe_product_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_plan_version" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"version" integer NOT NULL,
	"entitlements" jsonb NOT NULL,
	"included_monthly_credits" integer DEFAULT 0 NOT NULL,
	"overage_cents_per_thousand_credits" integer,
	"config_hash" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_price" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"interval" text NOT NULL,
	"unit_amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_price_stripe_price_id_unique" UNIQUE("stripe_price_id")
);
--> statement-breakpoint
CREATE TABLE "billing_subscription" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan_version_id" text NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"stripe_subscription_id" text,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"trial_ends_at" timestamp,
	"overage_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "credit_balance" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"trial_credits" integer DEFAULT 0 NOT NULL,
	"monthly_credits" integer DEFAULT 0 NOT NULL,
	"pack_credits" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"usage_event_id" text,
	"stripe_ref" text,
	"actor_user_id" text,
	"reason" text,
	"expires_at" timestamp,
	"period_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"credits" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"stripe_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_pack_key_unique" UNIQUE("key"),
	CONSTRAINT "credit_pack_stripe_price_id_unique" UNIQUE("stripe_price_id")
);
--> statement-breakpoint
CREATE TABLE "credit_rate_version" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"rates" jsonb NOT NULL,
	"effective_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "credit_rate_version_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"site_id" text,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"credits" integer NOT NULL,
	"rate_version" integer NOT NULL,
	"request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_customer" ADD CONSTRAINT "billing_customer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_plan_version" ADD CONSTRAINT "billing_plan_version_plan_key_billing_plan_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."billing_plan"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_price" ADD CONSTRAINT "billing_price_plan_key_billing_plan_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."billing_plan"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription" ADD CONSTRAINT "billing_subscription_plan_version_id_billing_plan_version_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."billing_plan_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_event_id_usage_event_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_event" ADD CONSTRAINT "usage_event_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billingPlanVersion_plan_version_idx" ON "billing_plan_version" USING btree ("plan_key","version");--> statement-breakpoint
CREATE INDEX "billingPrice_planKey_idx" ON "billing_price" USING btree ("plan_key");--> statement-breakpoint
CREATE INDEX "billingSubscription_status_idx" ON "billing_subscription" USING btree ("status");--> statement-breakpoint
CREATE INDEX "creditLedger_org_createdAt_idx" ON "credit_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creditLedger_monthly_grant_uidx" ON "credit_ledger" USING btree ("organization_id","kind","period_key") WHERE "credit_ledger"."kind" = 'grant_monthly';--> statement-breakpoint
CREATE INDEX "stripeEvent_type_idx" ON "stripe_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "usageEvent_org_createdAt_idx" ON "usage_event" USING btree ("organization_id","created_at");