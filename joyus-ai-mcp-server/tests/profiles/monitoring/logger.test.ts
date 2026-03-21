/**
 * Unit tests for profiles/monitoring/logger.ts
 *
 * Uses a stub DB — no real database connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB Mock ────────────────────────────────────────────────────────────────

vi.mock('../../../src/db/client.js', () => {
  const mockInsert = vi.fn();
  const mockSelect = vi.fn();

  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  mockInsert.mockReturnValue(insertChain);

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
  };
  mockSelect.mockReturnValue(selectChain);

  return {
    db: { insert: mockInsert, select: mockSelect },
    profileOperationLogs: {},
  };
});

import { ProfileOperationLogger } from '../../../src/profiles/monitoring/logger.js';
import { db } from '../../../src/db/client.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ProfileOperationLogger.logOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when tenantId is empty', async () => {
    const logger = new ProfileOperationLogger();
    await expect(
      logger.logOperation({ tenantId: '', operation: 'generate', durationMs: 100, success: true }),
    ).rejects.toThrow('tenantId is required');
  });

  it('inserts a log row into the database', async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const logger = new ProfileOperationLogger();
    await logger.logOperation({
      tenantId: 'tenant-abc',
      operation: 'generate',
      durationMs: 250,
      success: true,
    });

    expect(db.insert).toHaveBeenCalledOnce();
    expect(insertChain.values).toHaveBeenCalledOnce();

    const values = insertChain.values.mock.calls[0][0] as Record<string, unknown>;
    expect(values['tenantId']).toBe('tenant-abc');
    expect(values['operation']).toBe('generate');
    expect(values['durationMs']).toBe(250);
    expect(values['success']).toBe(true);
  });

  it('emits structured JSON to stdout', async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const logger = new ProfileOperationLogger();
    await logger.logOperation({
      tenantId: 'tenant-abc',
      operation: 'rollback',
      profileIdentity: 'individual::author-001',
      durationMs: 50,
      success: true,
    });

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;

    expect(parsed['service']).toBe('profiles');
    expect(parsed['operation']).toBe('rollback');
    expect(parsed['tenantId']).toBe('tenant-abc');
    expect(parsed['profileIdentity']).toBe('individual::author-001');
    expect(parsed['timestamp']).toBeDefined();

    writeSpy.mockRestore();
  });

  it('sets level to "warn" on failure', async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const logger = new ProfileOperationLogger();
    await logger.logOperation({
      tenantId: 'tenant-abc',
      operation: 'generate',
      durationMs: 100,
      success: false,
    });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['level']).toBe('warn');

    writeSpy.mockRestore();
  });

  it('includes optional metadata fields in the row and stdout', async () => {
    const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(db.insert).mockReturnValue(insertChain as never);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const logger = new ProfileOperationLogger();
    await logger.logOperation({
      tenantId: 'tenant-abc',
      operation: 'cache_warm',
      durationMs: 10,
      success: true,
      metadata: { profileCount: 5 },
    });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(parsed['profileCount']).toBe(5);

    writeSpy.mockRestore();
  });
});

describe('ProfileOperationLogger.getOperationHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when tenantId is empty', async () => {
    const logger = new ProfileOperationLogger();
    await expect(logger.getOperationHistory('')).rejects.toThrow('tenantId is required');
  });

  it('returns empty array when no logs exist', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(db.select).mockReturnValue(selectChain as never);

    const logger = new ProfileOperationLogger();
    const result = await logger.getOperationHistory('tenant-abc');
    expect(result).toEqual([]);
  });
});
