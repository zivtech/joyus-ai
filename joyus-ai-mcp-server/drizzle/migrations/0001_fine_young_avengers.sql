CREATE SCHEMA IF NOT EXISTS "content";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "pipelines";
--> statement-breakpoint
CREATE TYPE "content"."content_source_status" AS ENUM('active', 'syncing', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "content"."content_source_type" AS ENUM('relational-database', 'rest-api');--> statement-breakpoint
CREATE TYPE "content"."content_sync_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "content"."content_sync_strategy" AS ENUM('mirror', 'pass-through', 'hybrid');--> statement-breakpoint
CREATE TYPE "content"."content_sync_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "pipelines"."concurrency_policy" AS ENUM('skip_if_running', 'queue', 'allow_concurrent');--> statement-breakpoint
CREATE TYPE "pipelines"."execution_status" AS ENUM('pending', 'running', 'paused_at_gate', 'paused_on_failure', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "pipelines"."execution_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'no_op');--> statement-breakpoint
CREATE TYPE "pipelines"."pipeline_status" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TYPE "pipelines"."review_decision_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "pipelines"."step_type" AS ENUM('profile_generation', 'fidelity_check', 'content_generation', 'source_query', 'review_gate', 'notification');--> statement-breakpoint
CREATE TYPE "pipelines"."trigger_event_status" AS ENUM('pending', 'acknowledged', 'processed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "pipelines"."trigger_event_type" AS ENUM('corpus_change', 'schedule_tick', 'manual_request');--> statement-breakpoint
CREATE TABLE "content"."api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"integration_name" text NOT NULL,
	"jwks_uri" text,
	"issuer" text,
	"audience" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "content"."drift_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"generations_evaluated" integer NOT NULL,
	"overall_drift_score" real NOT NULL,
	"dimension_scores" jsonb NOT NULL,
	"recommendations" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"product_id" text NOT NULL,
	"resolved_from" text NOT NULL,
	"resolved_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."generation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text,
	"profile_id" text,
	"query" text NOT NULL,
	"sources_used" jsonb NOT NULL,
	"citation_count" integer DEFAULT 0 NOT NULL,
	"response_length" integer NOT NULL,
	"drift_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."items" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"source_ref" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"content_type" text DEFAULT 'text' NOT NULL,
	"metadata" jsonb NOT NULL,
	"data_tier" integer DEFAULT 1 NOT NULL,
	"search_vector" "tsvector",
	"last_synced_at" timestamp NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."mediation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"user_id" text NOT NULL,
	"active_profile_id" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "content"."operation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operation" text NOT NULL,
	"source_id" text,
	"user_id" text,
	"duration_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."product_profiles" (
	"product_id" text NOT NULL,
	"profile_id" text NOT NULL,
	CONSTRAINT "product_profiles_product_id_profile_id_pk" PRIMARY KEY("product_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "content"."product_sources" (
	"product_id" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "product_sources_product_id_source_id_pk" PRIMARY KEY("product_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "content"."products" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."sources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "content"."content_source_type" NOT NULL,
	"sync_strategy" "content"."content_sync_strategy" NOT NULL,
	"connection_config" jsonb NOT NULL,
	"freshness_window_minutes" integer DEFAULT 1440 NOT NULL,
	"status" "content"."content_source_status" DEFAULT 'active' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"schema_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content"."sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"status" "content"."content_sync_run_status" NOT NULL,
	"trigger" "content"."content_sync_trigger" NOT NULL,
	"items_discovered" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_removed" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pipelines"."execution_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"step_id" text NOT NULL,
	"position" integer NOT NULL,
	"status" "pipelines"."execution_step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"error_detail" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pipelines"."pipeline_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"trigger_event_id" text NOT NULL,
	"status" "pipelines"."execution_status" DEFAULT 'pending' NOT NULL,
	"steps_completed" integer DEFAULT 0 NOT NULL,
	"steps_total" integer NOT NULL,
	"current_step_position" integer DEFAULT 0 NOT NULL,
	"trigger_chain_depth" integer DEFAULT 0 NOT NULL,
	"output_artifacts" jsonb NOT NULL,
	"error_detail" jsonb,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pipelines"."pipeline_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"total_executions" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"mean_duration_ms" integer,
	"p95_duration_ms" integer,
	"failure_breakdown" jsonb NOT NULL,
	"review_approval_rate" real,
	"review_rejection_rate" real,
	"mean_time_to_review_ms" integer,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines"."pipeline_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"step_type" "pipelines"."step_type" NOT NULL,
	"config" jsonb NOT NULL,
	"input_refs" jsonb NOT NULL,
	"retry_policy_override" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines"."pipeline_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"definition" jsonb NOT NULL,
	"parameters" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "pipelines"."pipelines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" "pipelines"."trigger_event_type" NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"retry_policy" jsonb NOT NULL,
	"concurrency_policy" "pipelines"."concurrency_policy" DEFAULT 'skip_if_running' NOT NULL,
	"review_gate_timeout_hours" integer DEFAULT 48 NOT NULL,
	"max_pipeline_depth" integer DEFAULT 10 NOT NULL,
	"status" "pipelines"."pipeline_status" DEFAULT 'active' NOT NULL,
	"template_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines"."quality_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"signal_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines"."review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"execution_step_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"artifact_ref" jsonb NOT NULL,
	"profile_version_ref" text,
	"reviewer_id" text,
	"status" "pipelines"."review_decision_status" DEFAULT 'pending' NOT NULL,
	"feedback" jsonb,
	"decided_at" timestamp,
	"escalated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipelines"."trigger_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" "pipelines"."trigger_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "pipelines"."trigger_event_status" DEFAULT 'pending' NOT NULL,
	"pipelines_triggered" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "content"."entitlements" ADD CONSTRAINT "entitlements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD CONSTRAINT "mediation_sessions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "content"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_profiles" ADD CONSTRAINT "product_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_sources" ADD CONSTRAINT "product_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_sources" ADD CONSTRAINT "product_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."sync_runs" ADD CONSTRAINT "sync_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."execution_steps" ADD CONSTRAINT "execution_steps_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "pipelines"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."execution_steps" ADD CONSTRAINT "execution_steps_step_id_pipeline_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "pipelines"."pipeline_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."pipeline_executions" ADD CONSTRAINT "pipeline_executions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."pipeline_executions" ADD CONSTRAINT "pipeline_executions_trigger_event_id_trigger_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "pipelines"."trigger_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."pipeline_metrics" ADD CONSTRAINT "pipeline_metrics_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."pipeline_steps" ADD CONSTRAINT "pipeline_steps_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."pipelines" ADD CONSTRAINT "pipelines_template_id_pipeline_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "pipelines"."pipeline_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."quality_signals" ADD CONSTRAINT "quality_signals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."review_decisions" ADD CONSTRAINT "review_decisions_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "pipelines"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines"."review_decisions" ADD CONSTRAINT "review_decisions_execution_step_id_execution_steps_id_fk" FOREIGN KEY ("execution_step_id") REFERENCES "pipelines"."execution_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_api_keys_tenant_id_idx" ON "content"."api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "content_api_keys_tenant_active_idx" ON "content"."api_keys" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "content_drift_tenant_profile_window_idx" ON "content"."drift_reports" USING btree ("tenant_id","profile_id","window_end");--> statement-breakpoint
CREATE INDEX "content_drift_profile_created_idx" ON "content"."drift_reports" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "content_entitlements_session_user_idx" ON "content"."entitlements" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "content_entitlements_user_product_idx" ON "content"."entitlements" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "content_entitlements_tenant_id_idx" ON "content"."entitlements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "content_gen_logs_tenant_created_idx" ON "content"."generation_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "content_gen_logs_tenant_user_idx" ON "content"."generation_logs" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "content_gen_logs_profile_created_idx" ON "content"."generation_logs" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "content_items_source_id_idx" ON "content"."items" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_source_ref_unique" ON "content"."items" USING btree ("source_id","source_ref");--> statement-breakpoint
CREATE INDEX "content_items_source_stale_idx" ON "content"."items" USING btree ("source_id","is_stale");--> statement-breakpoint
CREATE INDEX "content_sessions_tenant_user_idx" ON "content"."mediation_sessions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "content_sessions_api_key_id_idx" ON "content"."mediation_sessions" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "content_sessions_tenant_activity_idx" ON "content"."mediation_sessions" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "content_op_logs_tenant_op_created_idx" ON "content"."operation_logs" USING btree ("tenant_id","operation","created_at");--> statement-breakpoint
CREATE INDEX "content_op_logs_tenant_created_idx" ON "content"."operation_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "content_products_tenant_id_idx" ON "content"."products" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_products_tenant_name_unique" ON "content"."products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "content_sources_tenant_id_idx" ON "content"."sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "content_sources_tenant_type_idx" ON "content"."sources" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "content_sources_tenant_status_idx" ON "content"."sources" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "content_sync_runs_source_started_idx" ON "content"."sync_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "content_sync_runs_status_idx" ON "content"."sync_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "exec_steps_execution_position_unique" ON "pipelines"."execution_steps" USING btree ("execution_id","position");--> statement-breakpoint
CREATE INDEX "exec_steps_execution_id_idx" ON "pipelines"."execution_steps" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "exec_steps_execution_status_idx" ON "pipelines"."execution_steps" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "executions_pipeline_started_idx" ON "pipelines"."pipeline_executions" USING btree ("pipeline_id","started_at");--> statement-breakpoint
CREATE INDEX "executions_tenant_started_idx" ON "pipelines"."pipeline_executions" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "executions_tenant_status_idx" ON "pipelines"."pipeline_executions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "pipelines"."pipeline_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_metrics_pipeline_window_idx" ON "pipelines"."pipeline_metrics" USING btree ("pipeline_id","window_end");--> statement-breakpoint
CREATE INDEX "pipeline_metrics_tenant_window_idx" ON "pipelines"."pipeline_metrics" USING btree ("tenant_id","window_end");--> statement-breakpoint
CREATE INDEX "pipeline_metrics_tenant_id_idx" ON "pipelines"."pipeline_metrics" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_steps_pipeline_position_unique" ON "pipelines"."pipeline_steps" USING btree ("pipeline_id","position");--> statement-breakpoint
CREATE INDEX "pipeline_steps_pipeline_id_idx" ON "pipelines"."pipeline_steps" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "pipeline_templates_tenant_id_idx" ON "pipelines"."pipeline_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pipeline_templates_category_active_idx" ON "pipelines"."pipeline_templates" USING btree ("category","is_active");--> statement-breakpoint
CREATE INDEX "pipeline_templates_active_idx" ON "pipelines"."pipeline_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "pipelines_tenant_id_idx" ON "pipelines"."pipelines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pipelines_tenant_status_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "pipelines_tenant_trigger_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","trigger_type");--> statement-breakpoint
CREATE UNIQUE INDEX "pipelines_tenant_name_unique" ON "pipelines"."pipelines" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "quality_signals_pipeline_id_idx" ON "pipelines"."quality_signals" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "quality_signals_tenant_id_idx" ON "pipelines"."quality_signals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quality_signals_unack_idx" ON "pipelines"."quality_signals" USING btree ("tenant_id","created_at") WHERE acknowledged_at IS NULL;--> statement-breakpoint
CREATE INDEX "review_decisions_execution_step_idx" ON "pipelines"."review_decisions" USING btree ("execution_id","execution_step_id");--> statement-breakpoint
CREATE INDEX "review_decisions_tenant_status_idx" ON "pipelines"."review_decisions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "review_decisions_step_status_idx" ON "pipelines"."review_decisions" USING btree ("execution_step_id","status");--> statement-breakpoint
CREATE INDEX "review_decisions_tenant_id_idx" ON "pipelines"."review_decisions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trigger_events_tenant_received_idx" ON "pipelines"."trigger_events" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "trigger_events_status_received_idx" ON "pipelines"."trigger_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "trigger_events_tenant_id_idx" ON "pipelines"."trigger_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "trigger_events_unprocessed_idx" ON "pipelines"."trigger_events" USING btree ("status","received_at") WHERE processed_at IS NULL;