---
work_package_id: WP01
title: Schema and Compatibility Migration
status: planned
depends_on: []
---

# WP01: Schema and Compatibility Migration

## Goal

Create first-class tenant and membership tables while preserving existing single-tenant behavior.

## Scope

- Add `tenants`, `tenant_memberships`, and `tenant_access_audit`.
- Enforce "at most one active primary membership per user" (FR-004) with a
  PARTIAL unique index `UNIQUE (user_id) WHERE is_primary AND status = 'active'`,
  not a plain unique index. If the target Postgres/Drizzle setup cannot express
  the partial index, fall back to documented app-level enforcement plus a test
  that asserts a second active primary membership is rejected.
- Export the schemas through `joyus-ai-mcp-server/src/db/schemas.ts` (the aggregator registry; `db/schema.ts` is the core schema module the aggregator consumes).
- Generate a Drizzle migration.
- Add idempotent compatibility seeding where each current user gets a primary membership with `tenantId === userId`.
- Add an optional helper to import `EXPORT_TENANT_ALLOWLIST` into memberships.

## Tests

- Schema migration applies cleanly.
- Compatibility seed can run twice without duplicate rows.
- A seeded user has one active primary membership.
- Allowlist import creates additional memberships without changing primary membership.

## Done When

- TypeScript compiles for new schema exports.
- Migration and seed tests pass.
- No client-specific tenant examples are introduced.
