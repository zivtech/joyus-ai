/**
 * Tests for ops-executor.ts — ops tool dispatcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/exports/service.js', () => ({
  createExcelExportJob: vi.fn().mockResolvedValue({
    job: { id: 'job-1', status: 'queued' },
    downloadUrl: 'https://example.com/download/job-1',
  }),
}));

import { executeOpsTool } from '../../src/tools/executors/ops-executor.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeOpsTool', () => {
  it('throws on unsupported tool name', async () => {
    await expect(
      executeOpsTool('ops_unknown', {}, { userId: 'user-1' }),
    ).rejects.toThrow('Unsupported ops tool');
  });

  it('throws when required tenant_id is missing', async () => {
    await expect(
      executeOpsTool('ops_export_excel', {}, { userId: 'user-1' }),
    ).rejects.toThrow('Missing required parameter: tenant_id');
  });

  it('ops_export_excel — creates export job', async () => {
    const result = await executeOpsTool(
      'ops_export_excel',
      { tenant_id: 'tenant-1' },
      { userId: 'user-1' },
    ) as any;

    expect(result).toBeDefined();
  });
});
