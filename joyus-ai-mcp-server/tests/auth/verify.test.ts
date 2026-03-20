/**
 * Unit tests for auth/verify.ts
 *
 * needsRefresh and getConnection are pure or thin-DB functions that can be
 * exercised without a real database. getUserFromToken is covered by
 * middleware.test.ts via its mock; here we test it directly with a DB mock.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB client before importing the module under test
vi.mock('../../src/db/client.js', () => {
  const mockDb = {
    select: vi.fn(),
  };
  return {
    db: mockDb,
    users: 'users_table',
    connections: 'connections_table',
  };
});

import { needsRefresh, getConnection, getUserFromToken } from '../../src/auth/verify.js';
import { db } from '../../src/db/client.js';

// Typed helper so tests can configure select chains concisely
function mockSelectChain(returnValue: unknown) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(returnValue),
  };
  vi.mocked(db.select).mockReturnValue(chain as never);
  return chain;
}

// ============================================================
// needsRefresh
// ============================================================

describe('needsRefresh', () => {
  it('returns false when expiresAt is null', () => {
    expect(needsRefresh(null)).toBe(false);
  });

  it('returns true when expiry is less than 5 minutes away', () => {
    const inFourMinutes = new Date(Date.now() + 4 * 60 * 1000);
    expect(needsRefresh(inFourMinutes)).toBe(true);
  });

  it('returns false when expiry is more than 5 minutes away', () => {
    const inSixMinutes = new Date(Date.now() + 6 * 60 * 1000);
    expect(needsRefresh(inSixMinutes)).toBe(false);
  });

  it('returns true when expiry is exactly at the 5-minute boundary (edge case)', () => {
    // Exactly 5 minutes: 5*60*1000 ms. The condition is `< fiveMinutes`,
    // so at exactly 5 minutes the difference equals fiveMinutes — returns false.
    const exactlyFiveMinutes = new Date(Date.now() + 5 * 60 * 1000);
    expect(needsRefresh(exactlyFiveMinutes)).toBe(false);
  });

  it('returns true when token is already expired (past date)', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(needsRefresh(yesterday)).toBe(true);
  });
});

// ============================================================
// getConnection
// ============================================================

describe('getConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns connection when user has the service connected', async () => {
    const mockConnection = {
      id: 'conn-1',
      userId: 'user-1',
      service: 'GOOGLE',
      accessToken: 'encrypted-token',
      refreshToken: null,
      expiresAt: null,
      metadata: null,
    };
    mockSelectChain([mockConnection]);

    const result = await getConnection('user-1', 'GOOGLE');

    expect(result).toEqual(mockConnection);
  });

  it('returns null when no connection exists for the service', async () => {
    mockSelectChain([]);

    const result = await getConnection('user-1', 'SLACK');

    expect(result).toBeNull();
  });

  it('returns null when user is not found', async () => {
    mockSelectChain([]);

    const result = await getConnection('nonexistent-user', 'GITHUB');

    expect(result).toBeNull();
  });

  it('queries by both userId and service', async () => {
    const chain = mockSelectChain([]);

    await getConnection('user-42', 'JIRA');

    expect(db.select).toHaveBeenCalled();
    expect(chain.from).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
    expect(chain.limit).toHaveBeenCalledWith(1);
  });
});

// ============================================================
// getUserFromToken
// ============================================================

describe('getUserFromToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no user matches the token', async () => {
    mockSelectChain([]);

    const result = await getUserFromToken('unknown-token');

    expect(result).toBeNull();
  });

  it('returns user with empty connections when user exists but has none', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'operator@example.com',
      name: 'Operator A',
      mcpToken: 'valid-token',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // First select: find user by token; second select: fetch connections
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockUser]),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      } as never);

    const result = await getUserFromToken('valid-token');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('user-1');
    expect(result!.email).toBe('operator@example.com');
    expect(result!.connections).toHaveLength(0);
  });

  it('returns user with mapped connections when connections exist', async () => {
    const mockUser = {
      id: 'user-2',
      email: 'contributor@example.com',
      name: 'Contributor B',
      mcpToken: 'token-abc',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const mockConn = {
      id: 'conn-1',
      userId: 'user-2',
      service: 'JIRA',
      accessToken: 'enc-access',
      refreshToken: 'enc-refresh',
      expiresAt: new Date(Date.now() + 3600 * 1000),
      metadata: { resources: [] },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockUser]),
      } as never)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([mockConn]),
      } as never);

    const result = await getUserFromToken('token-abc');

    expect(result!.connections).toHaveLength(1);
    expect(result!.connections[0].service).toBe('JIRA');
    expect(result!.connections[0].accessToken).toBe('enc-access');
    expect(result!.connections[0].refreshToken).toBe('enc-refresh');
  });
});
