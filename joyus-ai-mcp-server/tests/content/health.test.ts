/**
 * Tests for monitoring/health.ts — module-singleton DB pattern.
 * Mocks ../db/client.js at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client.js', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  contentSources: { status: 'status' },
}));

import { HealthChecker } from '../../src/content/monitoring/health.js';
import { db } from '../../src/db/client.js';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.execute).mockResolvedValue({ rows: [{ '?column?': 1 }] } as any);
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  } as any);
});

describe('HealthChecker', () => {
  it('reports healthy when all checks pass', async () => {
    const checker = new HealthChecker();
    const report = await checker.check();

    expect(report.status).toBe('healthy');
    expect(report.components.database.status).toBe('healthy');
    expect(report.timestamp).toBeDefined();
  });

  it('reports unhealthy when database is down', async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error('Connection refused'));

    const checker = new HealthChecker();
    const report = await checker.check();

    expect(report.status).toBe('unhealthy');
    expect(report.components.database.status).toBe('unhealthy');
    expect(report.components.database.detail).toContain('Connection refused');
  });

  it('reports degraded when some connectors are in error state', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          { status: 'active' },
          { status: 'error' },
        ]),
      }),
    } as any);

    const checker = new HealthChecker();
    const report = await checker.check();

    expect(report.components.connectors.status).toBe('degraded');
  });

  it('reports unhealthy when all connectors are in error state', async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          { status: 'error' },
          { status: 'error' },
        ]),
      }),
    } as any);

    const checker = new HealthChecker();
    const report = await checker.check();

    expect(report.components.connectors.status).toBe('unhealthy');
  });

  it('includes timestamp in ISO format', async () => {
    const checker = new HealthChecker();
    const report = await checker.check();

    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);
  });
});
