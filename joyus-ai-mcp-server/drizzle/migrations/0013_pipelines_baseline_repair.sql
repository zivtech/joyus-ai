-- 0013_pipelines_baseline_repair (#96)
--
-- Baseline/repair migration for stale-environment catch-up.
--
-- Why: the production database recorded migrations 0000-0007 against the
-- pre-rewrite chain (db:push era), so its actual schema never received the
-- "pipelines" objects that the rewritten 0001 creates. The migrator's
-- watermark skips 0001, and 0008+ then ALTER pipelines objects that do not
-- exist there. This migration recreates the complete final-state "pipelines"
-- schema with existence guards on every statement:
--   * fresh replays (0001 already ran): every statement is a no-op
--   * stale catch-up environments: schema, enums, tables, FKs, and indexes
--     are created here, immediately before first use
--
-- DDL is copied verbatim from 0001_fine_young_avengers.sql, except the
-- tenant/name index, which is created in its final post-0008 form
-- ("pipelines_tenant_name_idx", non-unique). The pre-0008 unique index is
-- intentionally NOT created.

CREATE SCHEMA IF NOT EXISTS "pipelines";

-- ============================================================
-- ENUMS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'concurrency_policy'
  ) THEN
    CREATE TYPE "pipelines"."concurrency_policy" AS ENUM('skip_if_running', 'queue', 'allow_concurrent');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'execution_status'
  ) THEN
    CREATE TYPE "pipelines"."execution_status" AS ENUM('pending', 'running', 'paused_at_gate', 'paused_on_failure', 'completed', 'failed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'execution_step_status'
  ) THEN
    CREATE TYPE "pipelines"."execution_step_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'no_op');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'pipeline_status'
  ) THEN
    CREATE TYPE "pipelines"."pipeline_status" AS ENUM('active', 'paused', 'disabled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'review_decision_status'
  ) THEN
    CREATE TYPE "pipelines"."review_decision_status" AS ENUM('pending', 'approved', 'rejected');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'step_type'
  ) THEN
    CREATE TYPE "pipelines"."step_type" AS ENUM('profile_generation', 'fidelity_check', 'content_generation', 'source_query', 'review_gate', 'notification');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'trigger_event_status'
  ) THEN
    CREATE TYPE "pipelines"."trigger_event_status" AS ENUM('pending', 'acknowledged', 'processed', 'failed', 'expired');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'pipelines' AND t.typname = 'trigger_event_type'
  ) THEN
    CREATE TYPE "pipelines"."trigger_event_type" AS ENUM('corpus_change', 'schedule_tick', 'manual_request');
  END IF;
END $$;

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS "pipelines"."pipeline_templates" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."pipelines" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."pipeline_steps" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."trigger_events" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."pipeline_executions" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."execution_steps" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."review_decisions" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."pipeline_metrics" (
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

CREATE TABLE IF NOT EXISTS "pipelines"."quality_signals" (
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

-- ============================================================
-- FOREIGN KEYS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipelines_template_id_pipeline_templates_id_fk'
      AND conrelid = 'pipelines.pipelines'::regclass
  ) THEN
    ALTER TABLE "pipelines"."pipelines" ADD CONSTRAINT "pipelines_template_id_pipeline_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "pipelines"."pipeline_templates"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_steps_pipeline_id_pipelines_id_fk'
      AND conrelid = 'pipelines.pipeline_steps'::regclass
  ) THEN
    ALTER TABLE "pipelines"."pipeline_steps" ADD CONSTRAINT "pipeline_steps_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_executions_pipeline_id_pipelines_id_fk'
      AND conrelid = 'pipelines.pipeline_executions'::regclass
  ) THEN
    ALTER TABLE "pipelines"."pipeline_executions" ADD CONSTRAINT "pipeline_executions_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_executions_trigger_event_id_trigger_events_id_fk'
      AND conrelid = 'pipelines.pipeline_executions'::regclass
  ) THEN
    ALTER TABLE "pipelines"."pipeline_executions" ADD CONSTRAINT "pipeline_executions_trigger_event_id_trigger_events_id_fk" FOREIGN KEY ("trigger_event_id") REFERENCES "pipelines"."trigger_events"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'execution_steps_execution_id_pipeline_executions_id_fk'
      AND conrelid = 'pipelines.execution_steps'::regclass
  ) THEN
    ALTER TABLE "pipelines"."execution_steps" ADD CONSTRAINT "execution_steps_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "pipelines"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'execution_steps_step_id_pipeline_steps_id_fk'
      AND conrelid = 'pipelines.execution_steps'::regclass
  ) THEN
    ALTER TABLE "pipelines"."execution_steps" ADD CONSTRAINT "execution_steps_step_id_pipeline_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "pipelines"."pipeline_steps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_decisions_execution_id_pipeline_executions_id_fk'
      AND conrelid = 'pipelines.review_decisions'::regclass
  ) THEN
    ALTER TABLE "pipelines"."review_decisions" ADD CONSTRAINT "review_decisions_execution_id_pipeline_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "pipelines"."pipeline_executions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_decisions_execution_step_id_execution_steps_id_fk'
      AND conrelid = 'pipelines.review_decisions'::regclass
  ) THEN
    ALTER TABLE "pipelines"."review_decisions" ADD CONSTRAINT "review_decisions_execution_step_id_execution_steps_id_fk" FOREIGN KEY ("execution_step_id") REFERENCES "pipelines"."execution_steps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_metrics_pipeline_id_pipelines_id_fk'
      AND conrelid = 'pipelines.pipeline_metrics'::regclass
  ) THEN
    ALTER TABLE "pipelines"."pipeline_metrics" ADD CONSTRAINT "pipeline_metrics_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_signals_pipeline_id_pipelines_id_fk'
      AND conrelid = 'pipelines.quality_signals'::regclass
  ) THEN
    ALTER TABLE "pipelines"."quality_signals" ADD CONSTRAINT "quality_signals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"."pipelines"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS "pipeline_templates_tenant_id_idx" ON "pipelines"."pipeline_templates" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "pipeline_templates_category_active_idx" ON "pipelines"."pipeline_templates" USING btree ("category","is_active");
CREATE INDEX IF NOT EXISTS "pipeline_templates_active_idx" ON "pipelines"."pipeline_templates" USING btree ("is_active");

CREATE INDEX IF NOT EXISTS "pipelines_tenant_id_idx" ON "pipelines"."pipelines" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "pipelines_tenant_status_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "pipelines_tenant_trigger_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","trigger_type");
-- Final-state form (0008): non-unique. The pre-0008 unique index is intentionally not created.
CREATE INDEX IF NOT EXISTS "pipelines_tenant_name_idx" ON "pipelines"."pipelines" USING btree ("tenant_id","name");

CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_steps_pipeline_position_unique" ON "pipelines"."pipeline_steps" USING btree ("pipeline_id","position");
CREATE INDEX IF NOT EXISTS "pipeline_steps_pipeline_id_idx" ON "pipelines"."pipeline_steps" USING btree ("pipeline_id");

CREATE INDEX IF NOT EXISTS "trigger_events_tenant_received_idx" ON "pipelines"."trigger_events" USING btree ("tenant_id","received_at");
CREATE INDEX IF NOT EXISTS "trigger_events_status_received_idx" ON "pipelines"."trigger_events" USING btree ("status","received_at");
CREATE INDEX IF NOT EXISTS "trigger_events_tenant_id_idx" ON "pipelines"."trigger_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "trigger_events_unprocessed_idx" ON "pipelines"."trigger_events" USING btree ("status","received_at") WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS "executions_pipeline_started_idx" ON "pipelines"."pipeline_executions" USING btree ("pipeline_id","started_at");
CREATE INDEX IF NOT EXISTS "executions_tenant_started_idx" ON "pipelines"."pipeline_executions" USING btree ("tenant_id","started_at");
CREATE INDEX IF NOT EXISTS "executions_tenant_status_idx" ON "pipelines"."pipeline_executions" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "executions_status_idx" ON "pipelines"."pipeline_executions" USING btree ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "exec_steps_execution_position_unique" ON "pipelines"."execution_steps" USING btree ("execution_id","position");
CREATE INDEX IF NOT EXISTS "exec_steps_execution_id_idx" ON "pipelines"."execution_steps" USING btree ("execution_id");
CREATE INDEX IF NOT EXISTS "exec_steps_execution_status_idx" ON "pipelines"."execution_steps" USING btree ("execution_id","status");

CREATE INDEX IF NOT EXISTS "review_decisions_execution_step_idx" ON "pipelines"."review_decisions" USING btree ("execution_id","execution_step_id");
CREATE INDEX IF NOT EXISTS "review_decisions_tenant_status_idx" ON "pipelines"."review_decisions" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "review_decisions_step_status_idx" ON "pipelines"."review_decisions" USING btree ("execution_step_id","status");
CREATE INDEX IF NOT EXISTS "review_decisions_tenant_id_idx" ON "pipelines"."review_decisions" USING btree ("tenant_id");

CREATE INDEX IF NOT EXISTS "pipeline_metrics_pipeline_window_idx" ON "pipelines"."pipeline_metrics" USING btree ("pipeline_id","window_end");
CREATE INDEX IF NOT EXISTS "pipeline_metrics_tenant_window_idx" ON "pipelines"."pipeline_metrics" USING btree ("tenant_id","window_end");
CREATE INDEX IF NOT EXISTS "pipeline_metrics_tenant_id_idx" ON "pipelines"."pipeline_metrics" USING btree ("tenant_id");

CREATE INDEX IF NOT EXISTS "quality_signals_pipeline_id_idx" ON "pipelines"."quality_signals" USING btree ("pipeline_id");
CREATE INDEX IF NOT EXISTS "quality_signals_tenant_id_idx" ON "pipelines"."quality_signals" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "quality_signals_unack_idx" ON "pipelines"."quality_signals" USING btree ("tenant_id","created_at") WHERE acknowledged_at IS NULL;
