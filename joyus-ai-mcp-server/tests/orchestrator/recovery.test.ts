/**
 * Unit tests for runCrashRecovery (T014).
 *
 * SessionService is mocked — no real database is required.
 * Tests verify:
 *   - No-op when no orphaned sessions are found
 *   - Marks each orphaned session as failed and returns correct counts
 *   - Counts skipped sessions when markOrphanedAsFailed returns null (race condition)
 *   - Counts errors when markOrphanedAsFailed throws
 *   - Does not throw when findAllOrphanedSessions itself fails
 */

import { describe, it, expect, vi } from 'vitest';

import { runCrashRecovery } from '../../src/orchestrator/recovery.js';
import type { SessionService } from '../../src/orchestrator/session.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'running',
    metadata: { model: 'claude-3' },
    inngestRunId: 'run-abc',
    createdAt: new Date('2020-01-01T00:00:00Z'),
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

function makeSessionService(overrides: Partial<SessionService> = {}): SessionService {
  return {
    findAllOrphanedSessions: vi.fn().mockResolvedValue([]),
    markOrphanedAsFailed: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as SessionService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCrashRecovery — no orphaned sessions', () => {
  it('returns zero counts when no sessions are orphaned', async () => {
    const service = makeSessionService({
      findAllOrphanedSessions: vi.fn().mockResolvedValue([]),
    });

    const result = await runCrashRecovery(service);

    expect(result).toEqual({ recovered: 0, skipped: 0, errors: 0 });
    expect(service.findAllOrphanedSessions).toHaveBeenCalledOnce();
    expect(service.markOrphanedAsFailed).not.toHaveBeenCalled();
  });
});

describe('runCrashRecovery — successfully marks orphaned sessions', () => {
  it('marks each orphaned session as failed and increments recovered count', async () => {
    const sessions = [
      buildMockSession({ id: 'session-1', tenantId: 'tenant-1' }),
      buildMockSession({ id: 'session-2', tenantId: 'tenant-2' }),
    ];

    const service = makeSessionService({
      findAllOrphanedSessions: vi.fn().mockResolvedValue(sessions),
      markOrphanedAsFailed: vi.fn().mockImplementation((tenantId, sessionId) =>
        Promise.resolve(buildMockSession({ id: sessionId, tenantId, status: 'failed' })),
      ),
    });

    const result = await runCrashRecovery(service);

    expect(result).toEqual({ recovered: 2, skipped: 0, errors: 0 });
    expect(service.markOrphanedAsFailed).toHaveBeenCalledTimes(2);
    expect(service.markOrphanedAsFailed).toHaveBeenCalledWith('tenant-1', 'session-1');
    expect(service.markOrphanedAsFailed).toHaveBeenCalledWith('tenant-2', 'session-2');
  });
});

describe('runCrashRecovery — skips when markOrphanedAsFailed returns null', () => {
  it('counts sessions as skipped when another process already advanced the status', async () => {
    const sessions = [buildMockSession({ id: 'session-1', tenantId: 'tenant-1' })];

    const service = makeSessionService({
      findAllOrphanedSessions: vi.fn().mockResolvedValue(sessions),
      // Returns null → session was updated by another pod before this one acted
      markOrphanedAsFailed: vi.fn().mockResolvedValue(null),
    });

    const result = await runCrashRecovery(service);

    expect(result).toEqual({ recovered: 0, skipped: 1, errors: 0 });
  });
});

describe('runCrashRecovery — handles markOrphanedAsFailed errors', () => {
  it('counts errors when markOrphanedAsFailed throws, continues with remaining sessions', async () => {
    const sessions = [
      buildMockSession({ id: 'session-1', tenantId: 'tenant-1' }),
      buildMockSession({ id: 'session-2', tenantId: 'tenant-1' }),
    ];

    const service = makeSessionService({
      findAllOrphanedSessions: vi.fn().mockResolvedValue(sessions),
      markOrphanedAsFailed: vi.fn()
        .mockRejectedValueOnce(new Error('DB connection lost'))
        .mockResolvedValueOnce(buildMockSession({ id: 'session-2', status: 'failed' })),
    });

    const result = await runCrashRecovery(service);

    expect(result).toEqual({ recovered: 1, skipped: 0, errors: 1 });
    expect(service.markOrphanedAsFailed).toHaveBeenCalledTimes(2);
  });
});

describe('runCrashRecovery — handles findAllOrphanedSessions failure', () => {
  it('returns errors=1 without throwing when the query itself fails', async () => {
    const service = makeSessionService({
      findAllOrphanedSessions: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    });

    const result = await runCrashRecovery(service);

    expect(result).toEqual({ recovered: 0, skipped: 0, errors: 1 });
    expect(service.markOrphanedAsFailed).not.toHaveBeenCalled();
  });
});
