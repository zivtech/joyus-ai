CREATE SCHEMA IF NOT EXISTS "content";
--> statement-breakpoint
CREATE TYPE "content"."content_source_status" AS ENUM('active', 'syncing', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "content"."content_source_type" AS ENUM('relational-database', 'rest-api');--> statement-breakpoint
CREATE TYPE "content"."content_sync_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "content"."content_sync_strategy" AS ENUM('mirror', 'pass-through', 'hybrid');--> statement-breakpoint
CREATE TYPE "content"."content_sync_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
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
ALTER TABLE "content"."entitlements" ADD CONSTRAINT "entitlements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."items" ADD CONSTRAINT "items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."mediation_sessions" ADD CONSTRAINT "mediation_sessions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "content"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_profiles" ADD CONSTRAINT "product_profiles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_sources" ADD CONSTRAINT "product_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "content"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."product_sources" ADD CONSTRAINT "product_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."sync_runs" ADD CONSTRAINT "sync_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "content"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
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
CREATE INDEX "content_items_search_vector_gin_idx" ON "content"."items" USING gin ("search_vector");--> statement-breakpoint
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
CREATE INDEX "content_sync_runs_status_idx" ON "content"."sync_runs" USING btree ("status");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "content"."content_items_search_vector_tgr_fn"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'english',
    concat_ws(' ', coalesce(NEW.title, ''), coalesce(NEW.body, ''))
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_items_search_vector_tgr"
BEFORE INSERT OR UPDATE OF "title", "body"
ON "content"."items"
FOR EACH ROW
EXECUTE FUNCTION "content"."content_items_search_vector_tgr_fn"();
--> statement-breakpoint
UPDATE "content"."items"
SET "search_vector" = to_tsvector(
  'english',
  concat_ws(' ', coalesce("title", ''), coalesce("body", ''))
)
WHERE "search_vector" IS NULL;
