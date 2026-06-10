-- Tenant memberships
-- Shared user-to-tenant grants for tenant resolution.
-- Generated: 2026-05-25
-- Idempotency guards added in #96: the journal `when` repair (1779710400000 ->
-- 1779713480600) can re-apply this file on environments that recorded it under
-- the old timestamp, so every statement must tolerate existing objects.

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
