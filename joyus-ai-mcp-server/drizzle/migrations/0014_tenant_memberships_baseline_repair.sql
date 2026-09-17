-- Tenant memberships baseline repair
-- Companion to 0013 (#96), addressing the second silent-skip class the journal
-- `when` reposition alone cannot fix.
--
-- 0009's repaired `when` (1779713480600) still sorts BELOW the 0010/0011
-- watermark (1779718567623 / 1779724808297). An environment that tracked main
-- incrementally under the OLD journal skipped 0009 (its old `when`,
-- 1779710400000, sorted below 0008's 1779713480527) while still applying
-- 0010/0011. drizzle-kit gates each migration on `when > max(applied
-- created_at)`, so on such an environment 0009 is skipped again, permanently —
-- `tenant_memberships` / `public.tenant_role` are never created and every query
-- against them fails with 42P01. Repositioning 0009 cannot rescue this class,
-- because keeping journal idx order monotonic forces 0009 below 0010/0011.
--
-- This migration re-runs 0009's (already idempotent) DDL from a `when`
-- (1781049600001) above every real environment's recorded watermark, so it
-- applies wherever the objects are missing and no-ops wherever 0009 already
-- ran. DDL is verbatim from 0009_tenant_memberships.sql; keep the two in sync.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'tenant_role'
  ) THEN
    CREATE TYPE "public"."tenant_role" AS ENUM('member', 'admin', 'operator');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "tenant_memberships" (
  "id"         TEXT PRIMARY KEY,
  "user_id"    TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id"  TEXT NOT NULL,
  "role"       "tenant_role" NOT NULL DEFAULT 'member',
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_user_tenant_unique"
  ON "tenant_memberships" ("user_id", "tenant_id");

CREATE INDEX IF NOT EXISTS "tenant_memberships_tenant_id_idx"
  ON "tenant_memberships" ("tenant_id");

CREATE INDEX IF NOT EXISTS "tenant_memberships_user_default_idx"
  ON "tenant_memberships" ("user_id", "is_default");

CREATE INDEX IF NOT EXISTS "tenant_memberships_user_role_idx"
  ON "tenant_memberships" ("user_id", "role");

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_user_default_unique"
  ON "tenant_memberships" ("user_id")
  WHERE "is_default" = TRUE;
