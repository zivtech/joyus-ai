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

import { createExcelExportJob } from '../../src/exports/service.js';
import { executeOpsTool } from '../../src/tools/executors/ops-executor.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeOpsTool', () => {
  it('throws on unsupported tool name', async () => {
    await expect(
      executeOpsTool('ops_unknown', {}, { userId: 'user-1', tenantId: 'tenant-1' }),
    ).rejects.toThrow('Unsupported ops tool');
  });

  it('throws when the resolved tenant context is missing', async () => {
    // The caller (executor.ts) resolves and authorizes the tenant; a missing
    // context.tenantId indicates a wiring bug and must fail closed.
    await expect(
      executeOpsTool('ops_export_excel', {}, { userId: 'user-1' } as never),
    ).rejects.toThrow('Missing required tenant context');
  });

  it('ops_export_excel — uses the resolved tenant from context, not raw input', async () => {
    await executeOpsTool(
      'ops_export_excel',
      // A divergent tenant_id in raw input must be ignored in favor of the
      // resolved-and-authorized context.tenantId.
      { tenant_id: 'tenant-from-input' },
      { userId: 'user-1', tenantId: 'tenant-resolved', tenantAccessPreResolved: true },
    );

    expect(vi.mocked(createExcelExportJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        tenantId: 'tenant-resolved',
        tenantAccessPreResolved: true,
      }),
    );
  });
});
