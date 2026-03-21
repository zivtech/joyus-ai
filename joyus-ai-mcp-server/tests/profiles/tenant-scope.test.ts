/**
 * Unit tests for profiles/tenant-scope helpers.
 *
 * These are pure logic tests — no database or Drizzle client required.
 */

import { describe, it, expect } from 'vitest';
import {
  requireTenantId,
  assertTenantOwnership,
} from '../../src/profiles/tenant-scope.js';

// ============================================================
// requireTenantId
// ============================================================

describe('requireTenantId', () => {
  it('throws on null', () => {
    expect(() => requireTenantId(null)).toThrow('tenantId is required');
  });

  it('throws on undefined', () => {
    expect(() => requireTenantId(undefined)).toThrow('tenantId is required');
  });

  it('throws on empty string', () => {
    expect(() => requireTenantId('')).toThrow('tenantId is required');
  });

  it('returns the tenantId when valid', () => {
    expect(requireTenantId('tenant-abc')).toBe('tenant-abc');
  });

  it('returns a CUID2-style id unchanged', () => {
    const id = 'clzk1234abcdefghijklmnop';
    expect(requireTenantId(id)).toBe(id);
  });
});

// ============================================================
// assertTenantOwnership
// ============================================================

describe('assertTenantOwnership', () => {
  it('does not throw when row belongs to the correct tenant', () => {
    const row = { tenantId: 'tenant-abc', id: 'row-1' };
    expect(() => assertTenantOwnership(row, 'tenant-abc')).not.toThrow();
  });

  it('throws when row belongs to a different tenant', () => {
    const row = { tenantId: 'tenant-xyz', id: 'row-1' };
    expect(() => assertTenantOwnership(row, 'tenant-abc')).toThrow(
      'Tenant ownership mismatch',
    );
  });

  it('includes both tenant IDs in the error message', () => {
    const row = { tenantId: 'tenant-xyz', id: 'row-1' };
    let errorMessage = '';
    try {
      assertTenantOwnership(row, 'tenant-abc');
    } catch (err) {
      errorMessage = (err as Error).message;
    }
    expect(errorMessage).toContain('tenant-xyz');
    expect(errorMessage).toContain('tenant-abc');
  });

  it('throws when the provided tenantId is empty (fail-closed)', () => {
    const row = { tenantId: 'tenant-abc', id: 'row-1' };
    expect(() => assertTenantOwnership(row, '')).toThrow('tenantId is required');
  });

  it('throws when the provided tenantId is null-coerced (fail-closed)', () => {
    const row = { tenantId: 'tenant-abc', id: 'row-1' };
    // Simulates a caller forgetting to validate before passing
    expect(() => assertTenantOwnership(row, null as unknown as string)).toThrow(
      'tenantId is required',
    );
  });
});
