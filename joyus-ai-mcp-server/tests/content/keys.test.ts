/**
 * Tests for ApiKeyService — DI-friendly key CRUD.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ApiKeyService } from '../../src/content/mediation/keys.js';

function createSelectResult(rows: unknown[]) {
  const query = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: ReturnType<typeof vi.fn>;
  };
  query.limit = vi.fn().mockResolvedValue(rows);
  return query;
}

function createMockDb(selectRows: unknown[] = [], returningRows: unknown[] = []) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateReturning = vi.fn().mockResolvedValue(returningRows);
  const updateWhere = vi.fn().mockReturnValue({
    returning: updateReturning,
  });
  const updateSet = vi.fn().mockReturnValue({
    where: updateWhere,
  });
  const selectWhere = vi.fn().mockReturnValue(createSelectResult(selectRows));

  return {
    insert: vi.fn().mockReturnValue({
      values: insertValues,
    }),
    update: vi.fn().mockReturnValue({
      set: updateSet,
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: selectWhere,
      }),
    }),
    __mocks: {
      insertValues,
      updateReturning,
      updateWhere,
      updateSet,
      selectWhere,
    },
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
      expect(result.keyPrefix).toBe(result.key.substring(0, 8));
      expect(db.insert).toHaveBeenCalledOnce();
      expect(db.__mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          keyPrefix: result.keyPrefix,
          integrationName: 'test-app',
          isActive: true,
        })
      );
      expect(db.__mocks.insertValues.mock.calls[0][0].keyHash).not.toBe(result.key);
    });

    it('passes optional JWKS/issuer/audience to insert', async () => {
      await service.createKey('tenant-1', {
        integrationName: 'test-app',
        jwksUri: 'https://example.com/.well-known/jwks.json',
        issuer: 'https://example.com',
        audience: 'api',
      });

      expect(db.insert).toHaveBeenCalledOnce();
      expect(db.__mocks.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          integrationName: 'test-app',
          jwksUri: 'https://example.com/.well-known/jwks.json',
          issuer: 'https://example.com',
          audience: 'api',
          isActive: true,
        })
      );
    });
  });

  describe('revokeKey', () => {
    it('sets isActive to false for an active key', async () => {
      const activeKey = { id: 'key-1', isActive: true };
      db = createMockDb([activeKey], [{ id: 'key-1', isActive: false }]);
      service = new ApiKeyService(db);

      const result = await service.revokeKey('key-1');

      expect(result.status).toBe('revoked');
      expect(db.update).toHaveBeenCalledOnce();
      expect(db.__mocks.updateSet).toHaveBeenCalledWith({ isActive: false });
    });

    it('reports an already revoked key without updating it again', async () => {
      const inactiveKey = { id: 'key-1', isActive: false };
      db = createMockDb([inactiveKey]);
      service = new ApiKeyService(db);

      const result = await service.revokeKey('key-1');

      expect(result.status).toBe('already_revoked');
      expect(db.update).not.toHaveBeenCalled();
    });

    it('reports a missing key without updating anything', async () => {
      const result = await service.revokeKey('missing-key');

      expect(result.status).toBe('not_found');
      expect(db.update).not.toHaveBeenCalled();
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
