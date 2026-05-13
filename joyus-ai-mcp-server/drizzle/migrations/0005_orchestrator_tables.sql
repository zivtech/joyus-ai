-- WP01: Orchestrator Tables
-- Session & Tenant Foundation
-- Generated: 2026-05-12
-- Note: This migration was authored manually because drizzle-kit generate
--       requires node_modules in the worktree, which are not installed.
--       Run `pnpm drizzle-kit generate` locally to regenerate with metadata.

-- =====================================================================
-- ENUM TYPES
-- =====================================================================

CREATE TYPE "public"."orchestrator_session_status" AS ENUM(
  'pending',
  'running',
  'suspended',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "public"."orchestrator_turn_role" AS ENUM(
  'user',
  'assistant',
  'tool'
);

-- =====================================================================
-- TABLES
-- =====================================================================

-- Orchestrator sessions: one per user interaction lifecycle.
-- All queries MUST include tenant_id in WHERE clause.
CREATE TABLE "orchestrator_sessions" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "user_id"       TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status"        "orchestrator_session_status" NOT NULL DEFAULT 'pending',
  "metadata"      JSONB DEFAULT '{}',
  "inngest_run_id" TEXT,
  "created_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "completed_at"  TIMESTAMP
);

-- Orchestrator turns: individual message exchanges within a session.
-- Immutable after creation. tenant_id is denormalized for query performance.
CREATE TABLE "orchestrator_turns" (
  "id"           TEXT PRIMARY KEY,
  "session_id"   TEXT NOT NULL REFERENCES "orchestrator_sessions"("id") ON DELETE CASCADE,
  "tenant_id"    TEXT NOT NULL,
  "sequence"     INTEGER NOT NULL,
  "role"         "orchestrator_turn_role" NOT NULL,
  "content"      TEXT,
  "tool_calls"   JSONB,
  "tool_results" JSONB,
  "token_usage"  JSONB,
  "created_at"   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- sessions: composite index for tenant + status queries
CREATE INDEX "orch_sessions_tenant_status_idx"
  ON "orchestrator_sessions" ("tenant_id", "status");

-- sessions: composite index for tenant + user + ordered listing
CREATE INDEX "orch_sessions_tenant_user_created_idx"
  ON "orchestrator_sessions" ("tenant_id", "user_id", "created_at");

-- sessions: inngest run ID lookup (used for crash recovery)
CREATE INDEX "orch_sessions_inngest_run_idx"
  ON "orchestrator_sessions" ("inngest_run_id");

-- turns: unique constraint on session + sequence (enforces ordering)
CREATE UNIQUE INDEX "orch_turns_session_sequence_unique"
  ON "orchestrator_turns" ("session_id", "sequence");

-- turns: composite index for tenant-scoped session queries
CREATE INDEX "orch_turns_tenant_session_idx"
  ON "orchestrator_turns" ("tenant_id", "session_id");
