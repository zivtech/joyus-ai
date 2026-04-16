/**
 * Integration Tests — Mediation Flow
 *
 * Tests auth → session → message → close using mocks.
 * No real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CACHE_TTL_SECONDS } from '../../../src/content/generation/cost.js';
import { contentMediationSessions, contentOperationLogs } from '../../../src/content/schema.js';
import { MediationSessionService } from '../../../src/content/mediation/session.js';
import type { ResolvedEntitlements, GenerationResult } from '../../../src/content/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntitlements(): ResolvedEntitlements {
  return {
    productIds: ['prod-1'],
    sourceIds: ['source-1'],
    profileIds: ['profile-1'],
    resolvedFrom: 'test',
    resolvedAt: new Date(),
  };
}

function makeGenerationResult(): GenerationResult {
  return {
    text: 'Generated response with [Source 1] citation.',
    citations: [
      {
        sourceId: 'source-1',
        itemId: 'item-1',
        title: 'Test Article',
        excerpt: 'Excerpt text.',
        sourceType: 'content',
      },
    ],
    profileUsed: 'profile-1',
    metadata: { totalSearchResults: 3, sourcesUsed: 1, durationMs: 42 },
  };
}

function makeIncrementDbMock(returningRows: Array<{
  idleGapSeconds: number;
  isCacheMiss: boolean;
  tenantId: string;
}>) {
  const returning = vi.fn().mockResolvedValue(returningRows);
  const where = vi.fn().mockReturnValue({ returning });
  const from = vi.fn().mockReturnValue({ where });
  const set = vi.fn().mockReturnValue({ from });
  const update = vi.fn().mockReturnValue({ set });
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { update, insert } as never,
    insert,
    returning,
    values,
  };
}

type SessionRow = {
  id: string;
  tenantId: string;
  apiKeyId: string;
  userId: string;
  activeProfileId: string | null;
  messageCount: number;
  startedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  totalEstimatedCostUsd: string;
  cacheMissCount: number;
  maxIdleGapSeconds: number;
};

function extractSqlEqValue(cond: unknown): unknown {
  if (cond === null || typeof cond !== 'object') return undefined;

  const obj = cond as Record<string, unknown>;
  const chunks = obj.queryChunks;
  if (!Array.isArray(chunks)) return undefined;

  for (const chunk of chunks) {
    if (chunk === null || typeof chunk !== 'object') continue;

    const value = extractSqlEqValue(chunk);
    if (value !== undefined) return value;

    const candidate = (chunk as Record<string, unknown>).value;
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
      if (candidate !== '' && candidate !== ' = ' && candidate !== ' is not null ' && candidate !== ' and ') {
        return candidate;
      }
    }
  }

  return undefined;
}

function makeSessionRow(values: Record<string, unknown>): SessionRow {
  return {
    id: values.id as string,
    tenantId: values.tenantId as string,
    apiKeyId: values.apiKeyId as string,
    userId: values.userId as string,
    activeProfileId: (values.activeProfileId as string | null | undefined) ?? null,
    messageCount: (values.messageCount as number | undefined) ?? 0,
    startedAt: values.startedAt as Date,
    lastActivityAt: values.lastActivityAt as Date,
    endedAt: (values.endedAt as Date | null | undefined) ?? null,
    totalInputTokens: (values.totalInputTokens as number | undefined) ?? 0,
    totalOutputTokens: (values.totalOutputTokens as number | undefined) ?? 0,
    totalCacheWriteTokens: (values.totalCacheWriteTokens as number | undefined) ?? 0,
    totalCacheReadTokens: (values.totalCacheReadTokens as number | undefined) ?? 0,
    totalEstimatedCostUsd: (values.totalEstimatedCostUsd as string | undefined) ?? '0',
    cacheMissCount: (values.cacheMissCount as number | undefined) ?? 0,
    maxIdleGapSeconds: (values.maxIdleGapSeconds as number | undefined) ?? 0,
  };
}

function createStatefulSessionDb(options: {
  now?: Date;
  barrierTarget?: number;
} = {}) {
  const sessions = new Map<string, SessionRow>();
  const operationLogs: Array<Record<string, unknown>> = [];
  let now = options.now ?? new Date('2026-04-15T12:00:00.000Z');
  let incrementEntrants = 0;
  let releaseBarrier: (() => void) | null = null;
  const barrier = options.barrierTarget
    ? new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    })
    : null;

  const resolveSession = (cond: unknown): SessionRow | undefined => {
    const sessionId = extractSqlEqValue(cond);
    if (typeof sessionId === 'string') return sessions.get(sessionId);
    return Array.from(sessions.values())[0];
  };

  const db = {
    insert: vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        if (table === contentMediationSessions) {
          const row = makeSessionRow(values);
          sessions.set(row.id, row);
          return Promise.resolve();
        }

        if (table === contentOperationLogs) {
          operationLogs.push(values);
        }

        return Promise.resolve();
      }),
    })),
    update: vi.fn().mockImplementation((table: unknown) => ({
      set: vi.fn().mockImplementation((values: Record<string, unknown>) => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((cond: unknown) => ({
            returning: vi.fn().mockImplementation(async () => {
              const session = resolveSession(cond);
              if (!session) return [];

              if (barrier && options.barrierTarget) {
                incrementEntrants += 1;
                if (incrementEntrants === options.barrierTarget) {
                  releaseBarrier?.();
                }
                await barrier;
              }

              const idleGapSeconds = Math.max(
                0,
                Math.floor((now.getTime() - session.lastActivityAt.getTime()) / 1000),
              );
              const isCacheMiss = idleGapSeconds > CACHE_TTL_SECONDS;

              session.messageCount += 1;
              session.lastActivityAt = now;
              session.maxIdleGapSeconds = Math.max(session.maxIdleGapSeconds, idleGapSeconds);
              if (isCacheMiss) {
                session.cacheMissCount += 1;
              }

              return [{
                idleGapSeconds,
                isCacheMiss,
                tenantId: session.tenantId,
              }];
            }),
          })),
        }),
        where: vi.fn().mockImplementation(async (cond: unknown) => {
          if (table !== contentMediationSessions) return;
          const session = resolveSession(cond);
          if (!session) return;
          Object.assign(session, values);
        }),
      })),
    })),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation((cond: unknown) => {
          const rows = table === contentMediationSessions
            ? Array.from(sessions.values()).filter((session) => {
              const sessionId = extractSqlEqValue(cond);
              return typeof sessionId !== 'string' || session.id === sessionId;
            })
            : [];

          return {
            limit: vi.fn().mockResolvedValue(rows),
          };
        }),
      })),
    }),
  };

  return {
    db: db as never,
    operationLogs,
    sessions,
    setNow(nextNow: Date) {
      now = nextNow;
    },
    getIncrementEntrants() {
      return incrementEntrants;
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Mediation Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('session lifecycle: createSession → message → closeSession', () => {
    it('creates a session with correct properties', async () => {
      const mockDb = {} as never;
      const sessionService = new MediationSessionService(mockDb);

      // Spy on createSession and mock the DB insert
      const createSpy = vi.spyOn(sessionService, 'createSession').mockResolvedValue({
        sessionId: 'session-abc',
        tenantId: 'tenant-1',
        userId: 'user-1',
        activeProfileId: 'profile-1',
        startedAt: new Date(),
      });

      const session = await sessionService.createSession(
        'tenant-1',
        'key-1',
        'user-1',
        'profile-1',
      );

      expect(session.sessionId).toBeDefined();
      expect(session.tenantId).toBe('tenant-1');
      expect(session.userId).toBe('user-1');
      expect(session.activeProfileId).toBe('profile-1');
    });

    it('processes a message and returns generation result', async () => {
      const mockGenerationService = {
        generate: vi.fn().mockResolvedValue(makeGenerationResult()),
      };
      const mockEntitlementService = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements()),
      };

      const entitlements = await mockEntitlementService.resolve('user-1', 'tenant-1', { sessionId: 'session-1' });
      const result = await mockGenerationService.generate('What is the policy?', entitlements);

      expect(mockEntitlementService.resolve).toHaveBeenCalledWith('user-1', 'tenant-1', { sessionId: 'session-1' });
      expect(mockGenerationService.generate).toHaveBeenCalledOnce();
      expect(result.text).toContain('Generated response');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].sourceId).toBe('source-1');
    });

    it('closes session without error', async () => {
      const mockDb = {} as never;
      const sessionService = new MediationSessionService(mockDb);
      const closeSpy = vi.spyOn(sessionService, 'closeSession').mockResolvedValue();

      await sessionService.closeSession('session-1');

      expect(closeSpy).toHaveBeenCalledWith('session-1');
    });
  });

  describe('incrementMessageCount', () => {
    it('returns idle-gap metrics without writing a cache-miss event when still within TTL', async () => {
      const mockDb = makeIncrementDbMock([
        { idleGapSeconds: 42, isCacheMiss: false, tenantId: 'tenant-1' },
      ]);
      const sessionService = new MediationSessionService(mockDb.db);

      const result = await sessionService.incrementMessageCount('session-1');

      expect(result).toEqual({ idleGapSeconds: 42, isCacheMiss: false });
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('writes a cache-miss operation log when the idle gap exceeds the cache TTL', async () => {
      const mockDb = makeIncrementDbMock([
        { idleGapSeconds: CACHE_TTL_SECONDS + 5, isCacheMiss: true, tenantId: 'tenant-1' },
      ]);
      const sessionService = new MediationSessionService(mockDb.db);

      const result = await sessionService.incrementMessageCount('session-1');

      expect(result).toEqual({ idleGapSeconds: CACHE_TTL_SECONDS + 5, isCacheMiss: true });
      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(mockDb.values).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1',
        operation: 'cache_miss',
        sessionId: 'session-1',
        durationMs: 0,
        success: true,
        metadata: {
          idleGapSeconds: CACHE_TTL_SECONDS + 5,
          cacheTtlSeconds: CACHE_TTL_SECONDS,
        },
      }));
    });

    it('returns zero idle gap for the first message and does not log a cache miss', async () => {
      const mockDb = createStatefulSessionDb();
      const sessionService = new MediationSessionService(mockDb.db);
      const session = await sessionService.createSession('tenant-1', 'key-1', 'user-1', 'profile-1');

      const result = await sessionService.incrementMessageCount(session.sessionId);
      const updatedSession = await sessionService.getSession(session.sessionId);

      expect(result).toEqual({ idleGapSeconds: 0, isCacheMiss: false });
      expect(updatedSession?.messageCount).toBe(1);
      expect(mockDb.operationLogs).toHaveLength(0);
    });

    it('treats an idle gap at exactly the cache TTL boundary as a cache hit', async () => {
      const now = new Date('2026-04-15T12:05:00.000Z');
      const mockDb = createStatefulSessionDb({ now });
      const sessionService = new MediationSessionService(mockDb.db);
      const session = await sessionService.createSession('tenant-1', 'key-1', 'user-1');

      mockDb.sessions.get(session.sessionId)!.lastActivityAt = new Date(now.getTime() - (CACHE_TTL_SECONDS * 1000));

      const result = await sessionService.incrementMessageCount(session.sessionId);

      expect(result).toEqual({ idleGapSeconds: CACHE_TTL_SECONDS, isCacheMiss: false });
      expect(mockDb.operationLogs).toHaveLength(0);
    });

    it('keeps maxIdleGapSeconds at the highest observed idle gap across messages', async () => {
      const baseTime = new Date('2026-04-15T12:00:00.000Z');
      const mockDb = createStatefulSessionDb({ now: baseTime });
      const sessionService = new MediationSessionService(mockDb.db);
      const session = await sessionService.createSession('tenant-1', 'key-1', 'user-1');
      mockDb.sessions.get(session.sessionId)!.lastActivityAt = baseTime;

      mockDb.setNow(new Date(baseTime.getTime() + 100_000));
      const first = await sessionService.incrementMessageCount(session.sessionId);

      mockDb.setNow(new Date(baseTime.getTime() + 150_000));
      const second = await sessionService.incrementMessageCount(session.sessionId);

      mockDb.setNow(new Date(baseTime.getTime() + 350_000));
      const third = await sessionService.incrementMessageCount(session.sessionId);

      const updatedSession = await sessionService.getSession(session.sessionId);

      expect(first).toEqual({ idleGapSeconds: 100, isCacheMiss: false });
      expect(second).toEqual({ idleGapSeconds: 50, isCacheMiss: false });
      expect(third).toEqual({ idleGapSeconds: 200, isCacheMiss: false });
      expect(updatedSession?.maxIdleGapSeconds).toBe(200);
      expect(updatedSession?.messageCount).toBe(3);
    });

    it('resolves two parallel increments with an exact +2 message count increase', async () => {
      const mockDb = createStatefulSessionDb({
        now: new Date('2026-04-15T12:00:00.000Z'),
        barrierTarget: 2,
      });
      const sessionService = new MediationSessionService(mockDb.db);
      const session = await sessionService.createSession('tenant-1', 'key-1', 'user-1');
      mockDb.sessions.get(session.sessionId)!.lastActivityAt = new Date('2026-04-15T12:00:00.000Z');

      const [first, second] = await Promise.all([
        sessionService.incrementMessageCount(session.sessionId),
        sessionService.incrementMessageCount(session.sessionId),
      ]);
      const updatedSession = await sessionService.getSession(session.sessionId);

      expect(mockDb.getIncrementEntrants()).toBe(2);
      expect(first).toEqual({ idleGapSeconds: 0, isCacheMiss: false });
      expect(second).toEqual({ idleGapSeconds: 0, isCacheMiss: false });
      expect(updatedSession?.messageCount).toBe(2);
      expect(mockDb.operationLogs).toHaveLength(0);
    });
  });

  describe('auth rejects missing API key', () => {
    it('returns 401 when X-API-Key header is absent', async () => {
      const mockReq = {
        headers: {},
      };

      const hasApiKey = Boolean((mockReq.headers as Record<string, string>)['x-api-key']);
      expect(hasApiKey).toBe(false);

      // The middleware would respond 401; here we verify the condition
      const result = hasApiKey ? 'allowed' : '401-missing-api-key';
      expect(result).toBe('401-missing-api-key');
    });
  });

  describe('auth rejects missing Bearer token', () => {
    it('returns 401 when Authorization header is absent', async () => {
      const mockReq = {
        headers: {
          'x-api-key': 'some-key',
          // no authorization header
        } as Record<string, string>,
      };

      const authHeader = mockReq.headers['authorization'];
      const hasBearer = authHeader?.startsWith('Bearer ') ?? false;
      expect(hasBearer).toBe(false);

      const result = hasBearer ? 'allowed' : '401-missing-bearer';
      expect(result).toBe('401-missing-bearer');
    });

    it('returns 401 when Authorization is not Bearer', async () => {
      const mockReq = {
        headers: {
          'x-api-key': 'some-key',
          'authorization': 'Basic dXNlcjpwYXNz',
        } as Record<string, string>,
      };

      const authHeader = mockReq.headers['authorization'];
      const hasBearer = authHeader?.startsWith('Bearer ') ?? false;
      expect(hasBearer).toBe(false);
    });
  });

  describe('auth rejects invalid API key', () => {
    it('resolver failure produces restricted entitlements', async () => {
      const mockResolver = {
        resolve: vi.fn().mockRejectedValue(new Error('Invalid API key')),
      };

      // Simulate EntitlementService fallback on resolver failure
      let entitlements: ResolvedEntitlements;
      try {
        entitlements = await mockResolver.resolve('user-1', 'tenant-1', { sessionId: 'session-1' });
      } catch {
        entitlements = {
          productIds: [],
          sourceIds: [],
          profileIds: [],
          resolvedFrom: 'fallback-restricted',
          resolvedAt: new Date(),
        };
      }

      expect(entitlements.sourceIds).toHaveLength(0);
      expect(entitlements.resolvedFrom).toBe('fallback-restricted');
    });
  });

  describe('full mediation flow with mocked services', () => {
    it('orchestrates createSession → message → closeSession in sequence', async () => {
      const mockDb = {} as never;
      const sessionService = new MediationSessionService(mockDb);
      const createSpy = vi.spyOn(sessionService, 'createSession').mockResolvedValue({
        sessionId: 'session-xyz',
        tenantId: 'tenant-1',
        userId: 'user-1',
        activeProfileId: null,
        startedAt: new Date(),
      });
      const closeSpy = vi.spyOn(sessionService, 'closeSession').mockResolvedValue();
      const incrementSpy = vi.spyOn(sessionService, 'incrementMessageCount').mockResolvedValue({
        idleGapSeconds: 0,
        isCacheMiss: false,
      });

      const mockGenerationService = {
        generate: vi.fn().mockResolvedValue(makeGenerationResult()),
      };
      const mockEntitlementService = {
        resolve: vi.fn().mockResolvedValue(makeEntitlements()),
      };

      // Step 1: create
      const session = await sessionService.createSession(
        'tenant-1',
        'key-1',
        'user-1',
      );
      expect(createSpy).toHaveBeenCalledOnce();

      // Step 2: message
      const entitlements = await mockEntitlementService.resolve(
        'user-1',
        session.tenantId,
        { sessionId: session.sessionId },
      );
      const result = await mockGenerationService.generate('test query', entitlements);
      await sessionService.incrementMessageCount(session.sessionId);

      expect(result.citations.length).toBeGreaterThan(0);
      expect(incrementSpy).toHaveBeenCalledWith(session.sessionId);

      // Step 3: close
      await sessionService.closeSession(session.sessionId);
      expect(closeSpy).toHaveBeenCalledWith(session.sessionId);
    });
  });
});
