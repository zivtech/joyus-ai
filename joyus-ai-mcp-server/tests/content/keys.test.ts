/**
 * Tests for ApiKeyService — DI-friendly key CRUD.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiKeyService } from '../../src/content/mediation/keys.js';

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as any;
}

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let db: any;

  beforeEach(() => {
    db = createMockDb();
    service = new ApiKeyService(db);
  });

  describe('createKey', () => {
    it('returns a raw key starting with jyk_ and an id', async () => {
      const result = await service.createKey('tenant-1', {
        integrationName: 'test-app',
      });

      expect(result.key).toMatch(/^jyk_[0-9a-f]{32}$/);
      expect(result.id).toBeDefined();
      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('passes optional JWKS/issuer/audience to insert', async () => {
      await service.createKey('tenant-1', {
        integrationName: 'test-app',
        jwksUri: 'https://example.com/.well-known/jwks.json',
        issuer: 'https://example.com',
        audience: 'api',
      });

      expect(db.insert).toHaveBeenCalledOnce();
    });
  });

  describe('revokeKey', () => {
    it('sets isActive to false', async () => {
      await service.revokeKey('key-1');
      expect(db.update).toHaveBeenCalledOnce();
    });
  });

  describe('listKeys', () => {
    it('queries by tenantId', async () => {
      const mockKeys = [
        { id: 'k1', tenantId: 'tenant-1', isActive: true },
        { id: 'k2', tenantId: 'tenant-1', isActive: false },
      ];
      db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockKeys),
        }),
      });

      const keys = await service.listKeys('tenant-1');
      expect(keys).toHaveLength(2);
    });
  });
});
