/**
 * Unit tests for export service helpers
 */

import { describe, expect, it, vi } from 'vitest';

import { canAccessTenant, normalizeExportLocations, normalizeExportScope } from '../src/exports/service.js';

describe('Export Service Helpers', () => {
  describe('normalizeExportScope', () => {
    it('should default to current_view', () => {
      expect(normalizeExportScope(undefined)).toBe('current_view');
      expect(normalizeExportScope('anything-else')).toBe('current_view');
    });

    it('should accept full_period', () => {
      expect(normalizeExportScope('full_period')).toBe('full_period');
    });
  });

  describe('normalizeExportLocations', () => {
    it('should default to current', () => {
      expect(normalizeExportLocations(undefined)).toBe('current');
      expect(normalizeExportLocations('other')).toBe('current');
    });

    it('should accept all_accessible', () => {
      expect(normalizeExportLocations('all_accessible')).toBe('all_accessible');
    });
  });

  describe('canAccessTenant', () => {
    it('should always allow same user and tenant id', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
      expect(canAccessTenant('user-1', 'user-1')).toBe(true);
    });

    it('should allow tenant from allowlist', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'false');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', 'user-1:tenant-a,user-2:tenant-b');
      expect(canAccessTenant('user-1', 'tenant-a')).toBe(true);
      expect(canAccessTenant('user-1', 'tenant-b')).toBe(false);
    });

    it('should allow any tenant when allow-any flag is true', () => {
      vi.stubEnv('EXPORT_ALLOW_ANY_TENANT', 'true');
      vi.stubEnv('EXPORT_TENANT_ALLOWLIST', '');
      expect(canAccessTenant('user-1', 'tenant-x')).toBe(true);
    });
  });
});

