/**
 * Tests for tools/executors/profile-executor.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const pipelineGenerateMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/profiles/generation/pipeline.js', () => ({
  ProfileGenerationPipeline: vi.fn().mockImplementation(() => ({
    generate: pipelineGenerateMock,
  })),
}));

import { executeProfileTool } from '../../../src/tools/executors/profile-executor.js';

function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain['from'] = vi.fn().mockReturnValue(chain);
  chain['where'] = vi.fn().mockReturnValue(chain);
  chain['limit'] = vi.fn().mockResolvedValue(rows);
  chain['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve);
  return chain;
}

function makeDb() {
  return {
    select: vi.fn(),
  };
}

describe('executeProfileTool — profile_generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineGenerateMock.mockResolvedValue({
      runId: 'run-001',
      status: 'completed',
      profileIds: ['profile-001'],
      durationMs: 42,
    });
  });

  it('runs generation and returns a pollable run id', async () => {
    const db = makeDb();
    db.select
      .mockReturnValueOnce(selectChain([
        {
          id: 'snap-001',
          name: 'Snapshot',
          documentHashes: ['hash-1'],
        },
      ]))
      .mockReturnValueOnce(selectChain([
        {
          authorId: 'author-001',
          authorName: 'Author One',
        },
      ]));

    const result = await executeProfileTool(
      'profile_generate',
      { corpusSnapshotId: 'snap-001' },
      { userId: 'user-001', tenantId: 'tenant-abc', db: db as never },
    );

    expect(result).toMatchObject({
      runId: 'run-001',
      status: 'completed',
      corpusSnapshotId: 'snap-001',
      profileIdentitiesQueued: ['base::author-001'],
    });
    expect(pipelineGenerateMock).toHaveBeenCalledWith('tenant-abc', {
      corpusPath: 'snap-001',
      corpusSnapshotId: 'snap-001',
      profileIdentities: ['base::author-001'],
      trigger: 'mcp_tool',
    });
  });

  it('derives authors only from the selected snapshot documents', async () => {
    const db = makeDb();
    db.select
      .mockReturnValueOnce(selectChain([
        {
          id: 'snap-001',
          name: 'Snapshot',
          documentHashes: ['snapshot-hash'],
        },
      ]))
      .mockReturnValueOnce(selectChain([
        {
          authorId: 'snapshot-author',
          authorName: 'Snapshot Author',
        },
      ]));

    await executeProfileTool(
      'profile_generate',
      { corpusSnapshotId: 'snap-001', tier: 'domain' },
      { userId: 'user-001', tenantId: 'tenant-abc', db: db as never },
    );

    expect(pipelineGenerateMock).toHaveBeenCalledWith(
      'tenant-abc',
      expect.objectContaining({
        profileIdentities: ['domain::snapshot-author'],
      }),
    );
  });

  it('throws when the selected snapshot has no attributed authors', async () => {
    const db = makeDb();
    db.select
      .mockReturnValueOnce(selectChain([
        {
          id: 'snap-empty',
          name: 'Empty Snapshot',
          documentHashes: [],
        },
      ]));

    await expect(
      executeProfileTool(
        'profile_generate',
        { corpusSnapshotId: 'snap-empty' },
        { userId: 'user-001', tenantId: 'tenant-abc', db: db as never },
      ),
    ).rejects.toThrow('No authors found in corpus for profile generation');
    expect(pipelineGenerateMock).not.toHaveBeenCalled();
  });
});
