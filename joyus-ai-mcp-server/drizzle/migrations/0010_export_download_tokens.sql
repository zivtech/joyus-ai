-- Issue 11: Export Download Tokens
-- Persist signed export download tokens for restart-safe and multi-instance downloads.
-- Generated: 2026-05-25
-- Note: This migration was authored manually to match the existing manual
--       migration pattern for post-0004 schema additions.

-- =====================================================================
-- TABLES
-- =====================================================================

-- token_id stores a deterministic hash of the bearer token, not the raw URL token.
CREATE TABLE "export_download_tokens" (
  "token_id"    TEXT PRIMARY KEY,
  "job_id"      TEXT NOT NULL,
  "user_id"     TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id"   TEXT NOT NULL,
  "export_type" TEXT NOT NULL,
  "file_path"   TEXT NOT NULL,
  "file_name"   TEXT,
  "created_at"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "expires_at"  TIMESTAMP NOT NULL
);

-- =====================================================================
-- INDEXES
-- =====================================================================

CREATE INDEX "export_download_tokens_tenant_user_idx"
  ON "export_download_tokens" ("tenant_id", "user_id");

CREATE INDEX "export_download_tokens_expires_at_idx"
  ON "export_download_tokens" ("expires_at");

CREATE INDEX "export_download_tokens_job_id_idx"
  ON "export_download_tokens" ("job_id");
