CREATE SCHEMA "event_adapter";
--> statement-breakpoint
CREATE TYPE "event_adapter"."auth_method" AS ENUM('hmac_sha256', 'api_key_header', 'ip_allowlist');--> statement-breakpoint
CREATE TYPE "event_adapter"."event_source_type" AS ENUM('github', 'generic_webhook');--> statement-breakpoint
CREATE TYPE "event_adapter"."lifecycle_state" AS ENUM('active', 'paused', 'disabled', 'archived');--> statement-breakpoint
CREATE TYPE "event_adapter"."webhook_event_source_type" AS ENUM('github', 'generic_webhook', 'schedule', 'automation_callback');--> statement-breakpoint
CREATE TYPE "event_adapter"."webhook_event_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TABLE "event_adapter"."automation_destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"url" varchar(2048) NOT NULL,
	"auth_header" varchar(255),
	"auth_secret_ref" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_forwarded_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_destinations_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "event_adapter"."scheduled_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"cron_expression" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'UTC' NOT NULL,
	"target_pipeline_id" text NOT NULL,
	"trigger_type" varchar(50) DEFAULT 'manual-request' NOT NULL,
	"trigger_metadata" jsonb,
	"lifecycle_state" "event_adapter"."lifecycle_state" DEFAULT 'active' NOT NULL,
	"last_fired_at" timestamp with time zone,
	"next_fire_at" timestamp with time zone,
	"paused_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_adapter"."event_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" varchar(255) NOT NULL,
	"source_type" "event_adapter"."event_source_type" NOT NULL,
	"endpoint_slug" varchar(100) NOT NULL,
	"auth_method" "event_adapter"."auth_method" NOT NULL,
	"auth_config" jsonb NOT NULL,
	"payload_mapping" jsonb,
	"target_pipeline_id" text,
	"target_trigger_type" varchar(50),
	"corpus_id" text,
	"lifecycle_state" "event_adapter"."lifecycle_state" DEFAULT 'active' NOT NULL,
	"is_platform_wide" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sources_endpoint_slug_unique" UNIQUE("endpoint_slug")
);
--> statement-breakpoint
CREATE TABLE "event_adapter"."platform_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_source_id" text NOT NULL,
	"target_pipeline_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_adapter"."webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"source_type" "event_adapter"."webhook_event_source_type" NOT NULL,
	"source_id" text,
	"schedule_id" text,
	"status" "event_adapter"."webhook_event_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb,
	"signature_valid" boolean,
	"translated_trigger" jsonb,
	"trigger_type" varchar(50),
	"pipeline_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"processing_duration_ms" integer,
	"forwarded_to_automation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "event_adapter"."platform_subscriptions" ADD CONSTRAINT "platform_subscriptions_event_source_id_event_sources_id_fk" FOREIGN KEY ("event_source_id") REFERENCES "event_adapter"."event_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ea_scheduled_tasks_active_next_fire_idx" ON "event_adapter"."scheduled_tasks" USING btree ("lifecycle_state","next_fire_at") WHERE lifecycle_state = 'active';--> statement-breakpoint
CREATE INDEX "ea_scheduled_tasks_tenant_id_idx" ON "event_adapter"."scheduled_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ea_event_sources_tenant_id_idx" ON "event_adapter"."event_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ea_platform_subscriptions_tenant_source_unique" ON "event_adapter"."platform_subscriptions" USING btree ("tenant_id","event_source_id");--> statement-breakpoint
CREATE INDEX "ea_webhook_events_tenant_status_idx" ON "event_adapter"."webhook_events" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "ea_webhook_events_source_type_source_id_idx" ON "event_adapter"."webhook_events" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "ea_webhook_events_created_at_idx" ON "event_adapter"."webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ea_webhook_events_pending_failed_idx" ON "event_adapter"."webhook_events" USING btree ("status") WHERE status IN ('pending', 'failed');