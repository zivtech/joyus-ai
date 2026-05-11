CREATE SCHEMA "profiles";
--> statement-breakpoint
CREATE TYPE "profiles"."document_format" AS ENUM('pdf', 'docx', 'txt', 'html', 'md');--> statement-breakpoint
CREATE TYPE "profiles"."generation_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "profiles"."profile_status" AS ENUM('active', 'archived', 'draft', 'superseded', 'rolled_back', 'deleted');--> statement-breakpoint
CREATE TYPE "profiles"."profile_tier" AS ENUM('base', 'domain', 'specialized', 'contextual');--> statement-breakpoint
CREATE TABLE "profiles"."corpus_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"original_filename" text NOT NULL,
	"format" "profiles"."document_format" NOT NULL,
	"title" text,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"extracted_text" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"data_tier" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles"."corpus_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"document_hashes" jsonb NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"author_count" integer DEFAULT 0 NOT NULL,
	"total_word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles"."generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"corpus_snapshot_id" text,
	"status" "profiles"."generation_run_status" DEFAULT 'pending' NOT NULL,
	"trigger" text NOT NULL,
	"profiles_requested" integer DEFAULT 0 NOT NULL,
	"profiles_completed" integer DEFAULT 0 NOT NULL,
	"profiles_failed" integer DEFAULT 0 NOT NULL,
	"profile_ids" jsonb NOT NULL,
	"error" text,
	"engine_version" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "profiles"."profile_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile_identity" text NOT NULL,
	"resolved_features" jsonb NOT NULL,
	"resolved_markers" jsonb NOT NULL,
	"override_sources" jsonb NOT NULL,
	"ancestor_versions" jsonb NOT NULL,
	"resolved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles"."profile_inheritance" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"parent_profile_identity" text NOT NULL,
	"child_profile_identity" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles"."operation_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"operation" text NOT NULL,
	"profile_identity" text,
	"user_id" text,
	"duration_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles"."tenant_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile_identity" text NOT NULL,
	"version" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"tier" "profiles"."profile_tier" NOT NULL,
	"parent_profile_id" text,
	"corpus_snapshot_id" text,
	"stylometric_features" jsonb NOT NULL,
	"markers" jsonb NOT NULL,
	"fidelity_score" real,
	"status" "profiles"."profile_status" DEFAULT 'draft' NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "profiles"."generation_runs" ADD CONSTRAINT "generation_runs_corpus_snapshot_id_corpus_snapshots_id_fk" FOREIGN KEY ("corpus_snapshot_id") REFERENCES "profiles"."corpus_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corpus_documents_tenant_id_idx" ON "profiles"."corpus_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_documents_tenant_content_hash_unique" ON "profiles"."corpus_documents" USING btree ("tenant_id","content_hash");--> statement-breakpoint
CREATE INDEX "corpus_documents_tenant_author_idx" ON "profiles"."corpus_documents" USING btree ("tenant_id","author_id");--> statement-breakpoint
CREATE INDEX "corpus_documents_tenant_active_idx" ON "profiles"."corpus_documents" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "corpus_snapshots_tenant_id_idx" ON "profiles"."corpus_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "corpus_snapshots_tenant_created_idx" ON "profiles"."corpus_snapshots" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_runs_tenant_id_idx" ON "profiles"."generation_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "generation_runs_tenant_started_idx" ON "profiles"."generation_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "generation_runs_status_idx" ON "profiles"."generation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "generation_runs_corpus_snapshot_id_idx" ON "profiles"."generation_runs" USING btree ("corpus_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_cache_tenant_identity_unique" ON "profiles"."profile_cache" USING btree ("tenant_id","profile_identity");--> statement-breakpoint
CREATE INDEX "profile_inheritance_tenant_id_idx" ON "profiles"."profile_inheritance" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "profile_inheritance_tenant_parent_idx" ON "profiles"."profile_inheritance" USING btree ("tenant_id","parent_profile_identity");--> statement-breakpoint
CREATE INDEX "profile_inheritance_tenant_child_idx" ON "profiles"."profile_inheritance" USING btree ("tenant_id","child_profile_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_inheritance_tenant_parent_child_unique" ON "profiles"."profile_inheritance" USING btree ("tenant_id","parent_profile_identity","child_profile_identity");--> statement-breakpoint
CREATE INDEX "profile_op_logs_tenant_op_created_idx" ON "profiles"."operation_logs" USING btree ("tenant_id","operation","created_at");--> statement-breakpoint
CREATE INDEX "profile_op_logs_tenant_created_idx" ON "profiles"."operation_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "tenant_profiles_tenant_id_idx" ON "profiles"."tenant_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_profiles_tenant_identity_idx" ON "profiles"."tenant_profiles" USING btree ("tenant_id","profile_identity");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_profiles_tenant_identity_version_unique" ON "profiles"."tenant_profiles" USING btree ("tenant_id","profile_identity","version");--> statement-breakpoint
CREATE INDEX "tenant_profiles_tenant_status_idx" ON "profiles"."tenant_profiles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tenant_profiles_tenant_tier_idx" ON "profiles"."tenant_profiles" USING btree ("tenant_id","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_profiles_active_unique" ON "profiles"."tenant_profiles" USING btree ("tenant_id","profile_identity") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "tenant_profiles_parent_profile_id_idx" ON "profiles"."tenant_profiles" USING btree ("parent_profile_id");