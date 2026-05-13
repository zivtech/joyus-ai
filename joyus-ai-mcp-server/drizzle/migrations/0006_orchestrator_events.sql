-- WP03: Orchestrator Events Table
-- Append-only typed event log for session lifecycle transitions, tool calls, and errors.
-- Generated: 2026-05-12
-- Note: This migration was authored manually because drizzle-kit generate
--       requires node_modules in the worktree, which are not installed.
--       Run `pnpm drizzle-kit generate` locally to regenerate with metadata.

-- =====================================================================
-- TABLE
-- =====================================================================

-- Orchestrator events: append-only record of all system state changes.
-- NEVER UPDATE or DELETE rows from this table.
-- All queries MUST include tenant_id in WHERE clause.
CREATE TABLE "orchestrator_events" (
  "id"          TEXT PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "session_id"  TEXT,
  "type"        TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  "sequence"    BIGSERIAL NOT NULL,
  "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================

-- Primary query path: tenant + type + time ordering
CREATE INDEX "orch_events_tenant_type_created_idx"
  ON "orchestrator_events" ("tenant_id", "type", "created_at");

-- Session-scoped queries with sequence ordering (hot path for SSE)
CREATE INDEX "orch_events_session_sequence_idx"
  ON "orchestrator_events" ("session_id", "sequence");

-- Global sequence index for replay / cursor-based pagination
CREATE INDEX "orch_events_sequence_idx"
  ON "orchestrator_events" ("sequence");
