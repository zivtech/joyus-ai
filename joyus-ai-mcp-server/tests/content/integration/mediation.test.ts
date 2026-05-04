/**
 * Integration Tests — Mediation Services
 *
 * Exercises real production code: MediationSessionService, createAuthMiddleware,
 * ContentGenerator, hashApiKey. Mocks only at the DB/network boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

import { CACHE_TTL_SECONDS } from '../../../src/content/generation/cost.js';
import { contentMediationSessions, contentOperationLogs } from '../../../src/content/schema.js';
import { MediationSessionService } from '../../../src/content/mediation/session.js';
import { createAuthMiddleware, hashApiKey } from '../../../src/content/mediation/auth.js';
import {
  ContentGenerator,
  PlaceholderGenerationProvider,
} from '../../../src/content/generation/generator.js';
import type { RetrievalResult } from '../../../src/content/generation/retriever.js';

// ── Mock DB builders ─────────────────────────────────────────────────────

function createSessionDb() {
  const store = new Map<string, any>();

  const db = {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: any) => {
        store.set(row.id, { ...row });
        return Promise.resolve();
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => {
            const rows = Array.from(store.values());
            return Promise.resolve(rows.length > 0 ? [rows[0]] : []);
          }),
        })),
      })),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => {
        const chain: any = {
          where: vi.fn().mockResolvedValue(undefined),
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { idleGapSeconds: 5, isCacheMiss: false, tenantId: 'tenant-1' },
              ]),
            }),
          }),
        };
        return chain;
      }),
    })),
  };

  return { db: db as any, store };
}

function createKeyDb(rows: any[] = []) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  } as any;
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

// ── Mock Express helpers ─────────────────────────────────────────────────

function mockReq(
  headers: Record<string, string> = {},
  extra: Record<string, any> = {},
) {
  return { headers, ...extra } as any;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

// ── MediationSessionService ──────────────────────────────────────────────

describe('MediationSessionService', () => {
  let service: MediationSessionService;
  let db: any;
  let store: Map<string, any>;

  beforeEach(() => {
    const mock = createSessionDb();
    db = mock.db;
    store = mock.store;
    service = new MediationSessionService(db);
  });

  describe('createSession', () => {
    it('inserts a row and returns session result', async () => {
      const result = await service.createSession(
        'tenant-1',
        'key-1',
        'user-1',
        'profile-1',
      );

      expect(result.sessionId).toBeDefined();
      expect(result.tenantId).toBe('tenant-1');
      expect(result.userId).toBe('user-1');
      expect(result.activeProfileId).toBe('profile-1');
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('defaults activeProfileId to null when omitted', async () => {
      const result = await service.createSession('tenant-1', 'key-1', 'user-1');
      expect(result.activeProfileId).toBeNull();
    });

    it('generates unique session IDs', async () => {
      const a = await service.createSession('t', 'k', 'u');
      const b = await service.createSession('t', 'k', 'u');
      expect(a.sessionId).not.toBe(b.sessionId);
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

  describe('getSession', () => {
    it('returns session when found', async () => {
      store.set('sess-1', {
        id: 'sess-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      });

      const result = await service.getSession('sess-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('sess-1');
    });

    it('returns null when not found', async () => {
      db.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const result = await service.getSession('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('closeSession', () => {
    it('calls update on the session', async () => {
      await service.closeSession('sess-1');
      expect(db.update).toHaveBeenCalledOnce();
    });
  });

  describe('incrementMessageCount', () => {
    it('calls update with messageCount increment and lastActivityAt', async () => {
      await service.incrementMessageCount('sess-1');
      expect(db.update).toHaveBeenCalledOnce();
    });
  });
});

// ── hashApiKey ───────────────────────────────────────────────────────────

describe('hashApiKey', () => {
  it('produces deterministic SHA-256 hex', () => {
    const hash1 = hashApiKey('test-key');
    const hash2 = hashApiKey('test-key');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different keys', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });
});

// ── Auth Middleware — validateApiKey ──────────────────────────────────────

describe('Auth Middleware — validateApiKey', () => {
  const keyHash = crypto
    .createHash('sha256')
    .update('valid-key')
    .digest('hex');

  const activeKeyRecord = {
    id: 'key-1',
    tenantId: 'tenant-1',
    keyHash,
    keyPrefix: 'valid-ke',
    integrationName: 'test',
    jwksUri: 'https://example.com/.well-known/jwks.json',
    issuer: 'https://example.com',
    audience: 'api',
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date(),
  };

  it('rejects missing X-API-Key with 401', async () => {
    const auth = createAuthMiddleware(createKeyDb());
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await auth.validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_api_key' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid API key with 401', async () => {
    const auth = createAuthMiddleware(createKeyDb([]));
    const req = mockReq({ 'x-api-key': 'bad-key' });
    const res = mockRes();
    const next = vi.fn();

    await auth.validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_api_key' }),
    );
  });

  it('rejects inactive API key with 401', async () => {
    const inactiveKey = { ...activeKeyRecord, isActive: false };
    const auth = createAuthMiddleware(createKeyDb([inactiveKey]));
    const req = mockReq({ 'x-api-key': 'valid-key' });
    const res = mockRes();
    const next = vi.fn();

    await auth.validateApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_api_key' }),
    );
  });

  it('attaches apiKeyRecord and tenantId on valid key', async () => {
    const auth = createAuthMiddleware(createKeyDb([activeKeyRecord]));
    const req = mockReq({ 'x-api-key': 'valid-key' });
    const res = mockRes();
    const next = vi.fn();

    await auth.validateApiKey(req, res, next);

    expect(req.apiKeyRecord).toBe(activeKeyRecord);
    expect(req.tenantId).toBe('tenant-1');
    expect(next).toHaveBeenCalledOnce();
  });
});

// ── Auth Middleware — validateUserToken ───────────────────────────────────

describe('Auth Middleware — validateUserToken', () => {
  function makeMinimalDb() {
    return {
      select: vi.fn(),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    } as any;
  }

  it('rejects missing Authorization header', async () => {
    const auth = createAuthMiddleware(makeMinimalDb());
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await auth.validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_user_token' }),
    );
  });

  it('rejects non-Bearer authorization', async () => {
    const auth = createAuthMiddleware(makeMinimalDb());
    const req = mockReq({ authorization: 'Basic abc123' });
    const res = mockRes();
    const next = vi.fn();

    await auth.validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_user_token' }),
    );
  });

  it('rejects when apiKeyRecord is missing from request', async () => {
    const auth = createAuthMiddleware(makeMinimalDb());
    const req = mockReq({ authorization: 'Bearer some.token.here' });
    const res = mockRes();
    const next = vi.fn();

    await auth.validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_api_key' }),
    );
  });

  it('rejects when jwksUri not configured', async () => {
    const auth = createAuthMiddleware(makeMinimalDb());
    const req = mockReq({ authorization: 'Bearer some.token.here' });
    req.apiKeyRecord = { jwksUri: null, issuer: null, audience: null };
    const res = mockRes();
    const next = vi.fn();

    await auth.validateUserToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_configuration' }),
    );
  });
});

// ── ContentGenerator ─────────────────────────────────────────────────────

describe('ContentGenerator', () => {
  const mockRetrieval: RetrievalResult = {
    items: [
      {
        itemId: 'item-1',
        sourceId: 'src-1',
        title: 'Article',
        body: 'Content here',
        metadata: {},
      },
    ],
    contextText: '[Source 1: "Article"] Content here',
    totalSearchResults: 1,
  };

  it('delegates to provider and returns output shape', async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue('Generated answer.'),
    };
    const gen = new ContentGenerator(provider);

    const result = await gen.generate('What is X?', mockRetrieval);

    expect(provider.generate).toHaveBeenCalledOnce();
    expect(result.text).toBe('Generated answer.');
    expect(result.sourcesProvided).toBe(1);
    expect(result.profileUsed).toBeNull();
  });

  it('includes profile in system prompt when provided', async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue('Response.'),
    };
    const gen = new ContentGenerator(provider);

    await gen.generate('query', mockRetrieval, 'voice-profile-1');

    const systemPrompt = provider.generate.mock.calls[0][1];
    expect(systemPrompt).toContain('voice profile "voice-profile-1"');
    expect(provider.generate.mock.calls[0][0]).toBe('query');
  });

  it('omits profile from system prompt when not provided', async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue('Response.'),
    };
    const gen = new ContentGenerator(provider);

    await gen.generate('query', mockRetrieval);

    const systemPrompt = provider.generate.mock.calls[0][1];
    expect(systemPrompt).not.toContain('voice profile');
  });

  it('includes reference material in system prompt', async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue('Response.'),
    };
    const gen = new ContentGenerator(provider);

    await gen.generate('query', mockRetrieval);

    const systemPrompt = provider.generate.mock.calls[0][1];
    expect(systemPrompt).toContain('REFERENCE MATERIAL');
    expect(systemPrompt).toContain('Content here');
    expect(systemPrompt).toContain('INSTRUCTIONS');
  });

  it('reports sourcesProvided from retrieval items count', async () => {
    const multiItemRetrieval: RetrievalResult = {
      items: [
        { itemId: 'a', sourceId: 's1', title: 'A', body: 'a', metadata: {} },
        { itemId: 'b', sourceId: 's2', title: 'B', body: 'b', metadata: {} },
        { itemId: 'c', sourceId: 's3', title: 'C', body: 'c', metadata: {} },
      ],
      contextText: 'multi-source context',
      totalSearchResults: 3,
    };
    const provider = { generate: vi.fn().mockResolvedValue('ok') };
    const gen = new ContentGenerator(provider);

    const result = await gen.generate('q', multiItemRetrieval);
    expect(result.sourcesProvided).toBe(3);
  });
});

describe('PlaceholderGenerationProvider', () => {
  it('returns descriptive non-configured message', async () => {
    const placeholder = new PlaceholderGenerationProvider();
    const result = await placeholder.generate('What is policy?', 'system');

    expect(result).toContain('Generation not configured');
    expect(result).toContain('What is policy?');
  });
});
