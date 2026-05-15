/**
 * Unit tests for SessionService.
 *
 * All DB calls are mocked — no real database is required.
 * Tests verify:
 *   - createSession inserts with correct defaults
 *   - getSession is always tenant-scoped
 *   - updateSessionStatus enforces the state machine
 *   - listSessions applies filters and pagination
 *   - crash recovery helpers identify orphaned sessions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionService } from '../../src/orchestrator/session.service.js';
import {
  InvalidStatusTransitionError,
  SessionNotFoundError,
} from '../../src/orchestrator/types.js';

// ---------------------------------------------------------------------------
// Mock DB factory
// ---------------------------------------------------------------------------

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function buildMockSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-cuid-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'pending',
    metadata: {},
    inngestRunId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

/**
 * Build a mock database where every method returns the provided rows.
 * Chainable query builder: db.select().from().where().limit() => rows
 * Chainable mutation: db.insert().values().returning() => rows
 *                     db.update().set().where().returning() => rows
 */
function makeDb(rows: unknown[] = []): MockDb {
  const returning = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const whereResult = {
    limit,
    returning,
    orderBy,
    then: (resolve: (value: Array<{ total: number }>) => unknown) => resolve([{ total: 0 }]),
  };
  const where = vi.fn().mockReturnValue(whereResult);
  const from = vi.fn().mockReturnValue({ where, orderBy });
  const values = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });

  // select() returns a builder
  const select = vi.fn().mockReturnValue({ from });
  // insert() returns a builder
  const insert = vi.fn().mockReturnValue({ values });
  // update() returns a builder
  const update = vi.fn().mockReturnValue({ set });

  return { select, insert, update } as unknown as MockDb;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT = 'tenant-abc';
const USER = 'user-xyz';
const SESSION_ID = 'session-cuid-1';

function makeService(rows: unknown[] = []) {
  const db = makeDb(rows);
  const service = new SessionService(
    db as never,
    10,
    { send: vi.fn().mockResolvedValue(undefined) },
  );
  return { db, service };
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('SessionService.createSession', () => {
  it('inserts a session with status pending and returns it', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT, userId: USER });
    const { db, service } = makeService([mockSession]);

    const result = await service.createSession({
      tenantId: TENANT,
      userId: USER,
      metadata: { source: 'api' },
    });

    expect(result).toEqual(mockSession);
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('emits orchestrator/session.created event after inserting the session row', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT, userId: USER });
    const db = makeDb([mockSession]);
    const inngestClient = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new SessionService(db as never, 10, inngestClient);

    await service.createSession({ tenantId: TENANT, userId: USER });

    expect(inngestClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'orchestrator/session.created',
        data: expect.objectContaining({
          // sessionId is a cuid2 generated at createSession call-time, not the mock's id
          sessionId: expect.any(String),
          tenantId: TENANT,
          userId: USER,
        }),
      }),
    );
  });

  it('records session.created in the typed event log when an EventService is provided', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT, userId: USER });
    const db = makeDb([mockSession]);
    const inngestClient = { send: vi.fn().mockResolvedValue(undefined) };
    const eventService = { emitEvent: vi.fn().mockResolvedValue(undefined) };
    const service = new SessionService(db as never, 10, inngestClient, eventService as never);

    await service.createSession({ tenantId: TENANT, userId: USER });

    expect(eventService.emitEvent).toHaveBeenCalledWith(
      TENANT,
      'session.created',
      expect.objectContaining({
        sessionId: expect.any(String),
        tenantId: TENANT,
        userId: USER,
      }),
      expect.any(String),
    );
  });

  it('emits orchestrator/session.queued when active sessions meet the tenant limit', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT, userId: USER });
    const inngestClient = { send: vi.fn().mockResolvedValue(undefined) };
    const db = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockSession]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 1 }]),
        }),
      }),
    };
    const service = new SessionService(db as never, 1, inngestClient);

    await service.createSession({ tenantId: TENANT, userId: USER });

    await vi.waitFor(() => {
      expect(inngestClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'orchestrator/session.queued',
          data: expect.objectContaining({
            sessionId: mockSession.id,
            tenantId: TENANT,
            queuedAt: expect.any(String),
          }),
        }),
      );
    });
  });

  it('does not fail createSession when inngestClient.send rejects', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT, userId: USER });
    const db = makeDb([mockSession]);
    const inngestClient = { send: vi.fn().mockRejectedValue(new Error('Inngest unavailable')) };
    const service = new SessionService(db as never, 10, inngestClient);

    // Must not throw
    const result = await service.createSession({ tenantId: TENANT, userId: USER });
    expect(result).toEqual(mockSession);
  });

  it('applies default empty metadata when omitted', async () => {
    const mockSession = buildMockSession({ metadata: {} });
    const { db, service } = makeService([mockSession]);

    const valuesCallArg = (db.insert as ReturnType<typeof vi.fn>).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockSession]),
      }),
    });

    // Recreate service with capture-friendly mock
    const captureDb = {
      insert: vi.fn().mockImplementation(() => {
        return {
          values: vi.fn().mockImplementation((args) => {
            expect(args.metadata).toEqual({});
            return { returning: vi.fn().mockResolvedValue([mockSession]) };
          }),
        };
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        }),
      }),
    } as unknown as ReturnType<typeof makeDb>;
    const captureService = new SessionService(
      captureDb as never,
      10,
      { send: vi.fn().mockResolvedValue(undefined) },
    );

    await captureService.createSession({ tenantId: TENANT, userId: USER });
    expect(captureDb.insert).toHaveBeenCalledOnce();
  });

  it('throws ZodError for empty tenantId', async () => {
    const { service } = makeService();
    await expect(
      service.createSession({ tenantId: '', userId: USER }),
    ).rejects.toThrow();
  });

  it('throws ZodError for empty userId', async () => {
    const { service } = makeService();
    await expect(
      service.createSession({ tenantId: TENANT, userId: '' }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getSession — tenant isolation
// ---------------------------------------------------------------------------

describe('SessionService.getSession', () => {
  it('returns the session when tenant matches', async () => {
    const mockSession = buildMockSession({ tenantId: TENANT });
    const { service } = makeService([mockSession]);

    const result = await service.getSession(TENANT, SESSION_ID);
    expect(result).toEqual(mockSession);
  });

  it('returns null when session is not found', async () => {
    const { service } = makeService([]); // empty result
    const result = await service.getSession(TENANT, 'missing-id');
    expect(result).toBeNull();
  });

  it('tenant isolation: returns null for empty results (simulates wrong tenant)', async () => {
    // The WHERE clause includes tenantId — DB returns nothing for a mismatch
    const { service } = makeService([]);
    const result = await service.getSession('other-tenant', SESSION_ID);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus — state machine
// ---------------------------------------------------------------------------

describe('SessionService.updateSessionStatus — valid transitions', () => {
  const cases: [string, string][] = [
    ['pending', 'running'],
    ['pending', 'cancelled'],
    ['running', 'suspended'],
    ['running', 'completed'],
    ['running', 'failed'],
    ['suspended', 'running'],
    ['suspended', 'failed'],
  ];

  for (const [from, to] of cases) {
    it(`allows ${from} → ${to}`, async () => {
      const current = buildMockSession({ status: from });
      const updated = buildMockSession({ status: to });

      // getSession (select) returns current; update.returning returns updated
      const selectLimit = vi.fn().mockResolvedValue([current]);
      const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
      const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

      const returning = vi.fn().mockResolvedValue([updated]);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const updateFn = vi.fn().mockReturnValue({ set: updateSet });

      const db = { select: selectFn, update: updateFn } as unknown as ReturnType<typeof makeDb>;
      const service = new SessionService(
        db as never,
        10,
        { send: vi.fn().mockResolvedValue(undefined) },
      );

      const result = await service.updateSessionStatus({
        tenantId: TENANT,
        sessionId: SESSION_ID,
        newStatus: to as never,
      });

      expect(result.status).toBe(to);
    });
  }
});

describe('SessionService.updateSessionStatus — invalid transitions', () => {
  const invalidCases: [string, string][] = [
    ['completed', 'running'],
    ['completed', 'failed'],
    ['failed', 'running'],
    ['failed', 'pending'],
    ['pending', 'completed'],
    ['pending', 'failed'],
    ['pending', 'suspended'],
    // cancelled is terminal — no transitions out
    ['cancelled', 'running'],
    ['cancelled', 'pending'],
    ['cancelled', 'completed'],
    // running cannot be directly cancelled — must go through pending→cancelled
    ['running', 'cancelled'],
  ];

  for (const [from, to] of invalidCases) {
    it(`rejects ${from} → ${to}`, async () => {
      const current = buildMockSession({ status: from });

      const selectLimit = vi.fn().mockResolvedValue([current]);
      const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
      const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
      const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

      const db = { select: selectFn } as unknown as ReturnType<typeof makeDb>;
      const service = new SessionService(db as never);

      await expect(
        service.updateSessionStatus({
          tenantId: TENANT,
          sessionId: SESSION_ID,
          newStatus: to as never,
        }),
      ).rejects.toThrow(InvalidStatusTransitionError);
    });
  }
});

describe('SessionService.updateSessionStatus — not found', () => {
  it('throws SessionNotFoundError when session does not exist', async () => {
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

    const db = { select: selectFn } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(db as never);

    await expect(
      service.updateSessionStatus({
        tenantId: TENANT,
        sessionId: 'missing',
        newStatus: 'running',
      }),
    ).rejects.toThrow(SessionNotFoundError);
  });
});

describe('SessionService.updateSessionStatus — completedAt', () => {
  it('sets completedAt when transitioning to completed', async () => {
    const current = buildMockSession({ status: 'running' });
    const updated = buildMockSession({ status: 'completed', completedAt: new Date() });

    const selectLimit = vi.fn().mockResolvedValue([current]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

    const returning = vi.fn().mockResolvedValue([updated]);
    const capturedSet: Record<string, unknown>[] = [];
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const updateSet = vi.fn().mockImplementation((updates) => {
      capturedSet.push(updates);
      return { where: updateWhere };
    });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const db = { select: selectFn, update: updateFn } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(db as never);

    await service.updateSessionStatus({
      tenantId: TENANT,
      sessionId: SESSION_ID,
      newStatus: 'completed',
    });

    expect(capturedSet[0]).toMatchObject({ status: 'completed', completedAt: expect.any(Date) });
  });
});

describe('SessionService.updateSessionStatus — event log', () => {
  it('records session.status_changed when an EventService is provided', async () => {
    const current = buildMockSession({ status: 'pending' });
    const updated = buildMockSession({ status: 'running' });

    const selectLimit = vi.fn().mockResolvedValue([current]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const selectFn = vi.fn().mockReturnValue({ from: selectFrom });

    const returning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const eventService = { emitEvent: vi.fn().mockResolvedValue(undefined) };
    const db = { select: selectFn, update: updateFn } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(
      db as never,
      10,
      { send: vi.fn().mockResolvedValue(undefined) },
      eventService as never,
    );

    await service.updateSessionStatus({
      tenantId: TENANT,
      sessionId: SESSION_ID,
      newStatus: 'running',
    });

    expect(eventService.emitEvent).toHaveBeenCalledWith(
      TENANT,
      'session.status_changed',
      {
        sessionId: SESSION_ID,
        tenantId: TENANT,
        previousStatus: 'pending',
        newStatus: 'running',
      },
      SESSION_ID,
    );
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('SessionService.listSessions', () => {
  it('returns items and no cursor when results <= limit', async () => {
    const sessions = [buildMockSession(), buildMockSession({ id: 'session-2' })];

    const limit = vi.fn().mockResolvedValue(sessions); // 2 items, limit=20 → no next page
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(db as never);

    const result = await service.listSessions(TENANT, { limit: 20 });
    expect(result.items).toHaveLength(2);
    expect(result.cursor).toBeUndefined();
  });

  it('returns cursor when DB returns limit+1 rows', async () => {
    // Request limit=2, DB returns 3 rows → has next page
    const sessions = [
      buildMockSession({ id: 's1', createdAt: new Date('2026-01-03T00:00:00Z') }),
      buildMockSession({ id: 's2', createdAt: new Date('2026-01-02T00:00:00Z') }),
      buildMockSession({ id: 's3', createdAt: new Date('2026-01-01T00:00:00Z') }),
    ];

    const limit = vi.fn().mockResolvedValue(sessions);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(db as never);

    const result = await service.listSessions(TENANT, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.cursor).toBeDefined();
    expect(typeof result.cursor).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// findAllOrphanedSessions
// ---------------------------------------------------------------------------

describe('SessionService.findAllOrphanedSessions', () => {
  it('returns sessions with status running and old updatedAt', async () => {
    const orphaned = [
      buildMockSession({ status: 'running', updatedAt: new Date('2020-01-01') }),
    ];

    const orderBy = vi.fn().mockResolvedValue(orphaned);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const db = { select } as unknown as ReturnType<typeof makeDb>;
    const service = new SessionService(db as never);

    const result = await service.findAllOrphanedSessions();
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('running');
  });
});
