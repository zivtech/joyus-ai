/**
 * Profile Isolation and Scale — Tenant-Scoping Helpers
 *
 * Utilities that enforce tenant isolation at the query layer.
 * All helpers are fail-closed: they throw rather than silently
 * allowing cross-tenant data access on any invalid input.
 */

import { and, eq, SQL } from 'drizzle-orm';

// ============================================================
// TYPES
// ============================================================

/** Any Drizzle table (or table-like object) that exposes a `tenantId` column. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TenantScopedTable = { tenantId: any; [key: string]: any };

/** A row that carries a `tenantId` string field. */
export interface TenantOwnedRow {
  tenantId: string;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Compose a WHERE clause that always includes a mandatory `tenant_id`
 * equality check, combined with any additional conditions.
 *
 * ```ts
 * const where = tenantWhere(tenantProfiles, ctx.tenantId,
 *   eq(tenantProfiles.status, 'active'));
 * const rows = await db.select().from(tenantProfiles).where(where);
 * ```
 *
 * @param table      Drizzle table with a `tenantId` column.
 * @param tenantId   Tenant identifier from the authenticated session context.
 * @param conditions Zero or more additional Drizzle SQL conditions.
 * @returns          A single composed SQL condition.
 */
export function tenantWhere(
  table: TenantScopedTable,
  tenantId: string,
  ...conditions: SQL[]
): SQL {
  requireTenantId(tenantId);
  const tenantCondition = eq(table.tenantId, tenantId);
  if (conditions.length === 0) {
    return tenantCondition;
  }
  return and(tenantCondition, ...conditions) as SQL;
}

/**
 * Validate that a tenantId is present and non-empty.
 * Throws if the value is null, undefined, or an empty string.
 * Fail-closed: missing tenantId must never silently pass through.
 *
 * @param tenantId   Value to validate.
 * @returns          The validated tenantId string (unchanged).
 * @throws           Error if tenantId is absent or empty.
 */
export function requireTenantId(tenantId: string | null | undefined): string {
  if (tenantId === null || tenantId === undefined || tenantId === '') {
    throw new Error('tenantId is required and must not be empty');
  }
  return tenantId;
}

/**
 * Assert that a fetched row belongs to the expected tenant.
 * Throws if the row's tenantId does not match, preventing cross-tenant
 * data leakage even when rows are retrieved by ID.
 *
 * @param row        Row returned from the database.
 * @param tenantId   Expected tenant identifier from the session context.
 * @throws           Error if the row belongs to a different tenant.
 */
export function assertTenantOwnership(
  row: TenantOwnedRow,
  tenantId: string,
): void {
  requireTenantId(tenantId);
  if (row.tenantId !== tenantId) {
    throw new Error(
      `Tenant ownership mismatch: row belongs to tenant "${row.tenantId}", ` +
      `but current tenant is "${tenantId}"`,
    );
  }
}
