-- Tenant memberships
-- Shared user-to-tenant grants for tenant resolution.
-- Generated: 2026-05-25

CREATE TYPE "public"."tenant_role" AS ENUM(
  'member',
  'admin',
  'operator'
);

CREATE TABLE "tenant_memberships" (
  "id"         TEXT PRIMARY KEY,
  "user_id"    TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id"  TEXT NOT NULL,
  "role"       "tenant_role" NOT NULL DEFAULT 'member',
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "tenant_memberships_user_tenant_unique"
  ON "tenant_memberships" ("user_id", "tenant_id");

CREATE INDEX "tenant_memberships_tenant_id_idx"
  ON "tenant_memberships" ("tenant_id");

CREATE INDEX "tenant_memberships_user_default_idx"
  ON "tenant_memberships" ("user_id", "is_default");

CREATE INDEX "tenant_memberships_user_role_idx"
  ON "tenant_memberships" ("user_id", "role");

CREATE UNIQUE INDEX "tenant_memberships_user_default_unique"
  ON "tenant_memberships" ("user_id")
  WHERE "is_default" = TRUE;
