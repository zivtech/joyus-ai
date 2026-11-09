import { vi, describe, it, expect } from 'vitest';

import { createFakePolicyReader, type FakePolicyAuthority } from '../src/skills/catalog/policy-s3.js';
import { createFakeCatalogSourcePort, type FakeSourceFixture } from '../src/skills/catalog/service-source.js';
import { createCatalogService } from '../src/skills/catalog/service.js';
import { computeLogicalSourceKey, sourceBindingRevision, type RefreshAttempt } from '../src/skills/catalog/types.js';
import { buildCandidate, buildPolicy, FakeClock, immediateSleep, tenantEntry } from './catalog-fixtures.js';

async function waitFinished(attempt: RefreshAttempt): Promise<void> {
  await vi.waitFor(() => {
    expect(attempt.state).not.toBe('in_progress');
  });
}

function makeService(policyAuthority: FakePolicyAuthority, fixtures: Map<string, FakeSourceFixture>, clock = new FakeClock()) {
  return createCatalogService({
    policyReader: createFakePolicyReader(policyAuthority),
    sourcePort: createFakeCatalogSourcePort(fixtures),
    resolveCredential: (alias) => `secret-for-${alias}`,
    clock,
    sleep: immediateSleep(),
  });
}

describe('refresh() coalescing', () => {
  it('coalesces concurrent triggers for the same source into the in-flight attempt', async () => {
    const candidate = buildCandidate([{ name: 'example-skill', description: 'Example knowledge.', priority: 10, scope: 'tenant', body: 'Body.' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-1', credentialAlias: 'alias-a' }) });
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-1', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 5 }],
    ]);
    const service = makeService({ policy }, fixtures);

    const first = service.refresh('tenant-a', 'startup');
    const second = service.refresh('tenant-a', 'manual');
    const third = service.refresh('tenant-a', 'timer');

    expect(second.operationId).toBe(first.operationId);
    expect(third.operationId).toBe(first.operationId);

    await waitFinished(first);
    expect(first.state).toBe('activated');
  });
});

describe('refresh() source-binding fencing and rollback', () => {
  it('rejects a changed-source candidate at activation time', async () => {
    const candidateV1 = buildCandidate([{ name: 'skill-v1', description: 'Version one.', priority: 10, scope: 'tenant', body: 'v1' }]);
    const candidateV2 = buildCandidate([{ name: 'skill-v2', description: 'Version two.', priority: 10, scope: 'tenant', body: 'v2' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-1', credentialAlias: 'alias-a' }) });
    const authority: FakePolicyAuthority = { policy };
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-1', indexRaw: candidateV1.indexRaw, documents: candidateV1.documents, delayMs: 10 }],
    ]);
    const service = makeService(authority, fixtures);

    const attempt = service.refresh('tenant-a', 'startup');

    // Rotate to a new epoch (rollback / re-approval) while the first candidate is still in flight.
    authority.policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-2', credentialAlias: 'alias-a', source: { provider: 'github', owner: 'example-org', repository: 'changed-source', ref: 'main' } }) });
    fixtures.set('secret-for-alias-a', { revision: 'rev-2', indexRaw: candidateV2.indexRaw, documents: candidateV2.documents });

    await waitFinished(attempt);
    expect(attempt.state).toBe('rejected');
    expect(attempt.category).toBe('superseded');

    const logicalSourceKey = computeLogicalSourceKey('tenant-a', policy.tenants['tenant-a'].source);
    expect(service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeUndefined();
  });

  it('lets a fresh candidate under the new epoch activate after rollback', async () => {
    const candidateV2 = buildCandidate([{ name: 'skill-v2', description: 'Version two.', priority: 10, scope: 'tenant', body: 'v2' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-2', credentialAlias: 'alias-a' }) });
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-2', indexRaw: candidateV2.indexRaw, documents: candidateV2.documents }],
    ]);
    const service = makeService({ policy }, fixtures);

    const attempt = service.refresh('tenant-a', 'manual');
    await waitFinished(attempt);
    expect(attempt.state).toBe('activated');
    expect(attempt.revision).toBe('rev-2');
  });
});

describe('refresh() bounded round-robin queue', () => {
  it('queues a source beyond the concurrent-attempt cap and runs it once a slot frees', async () => {
    const candidate = buildCandidate([{ name: 'skill', description: 'Example.', priority: 1, scope: 'tenant', body: 'x' }]);
    const policy = buildPolicy({
      'tenant-a': tenantEntry({ epoch: 'e1', credentialAlias: 'alias-a' }),
      'tenant-b': tenantEntry({ epoch: 'e1', credentialAlias: 'alias-b' }),
      'tenant-c': tenantEntry({ epoch: 'e1', credentialAlias: 'alias-c' }),
    });
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'r', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 15 }],
      ['secret-for-alias-b', { revision: 'r', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 15 }],
      ['secret-for-alias-c', { revision: 'r', indexRaw: candidate.indexRaw, documents: candidate.documents }],
    ]);
    const service = makeService({ policy }, fixtures);

    const a = service.refresh('tenant-a', 'startup');
    const b = service.refresh('tenant-b', 'startup');
    const c = service.refresh('tenant-c', 'startup'); // third source: queued behind the 2-concurrent cap

    expect(c.state).toBe('in_progress');
    await waitFinished(a);
    await waitFinished(b);
    await waitFinished(c);
    expect(c.state).toBe('activated');
  });
});

describe('shutdown', () => {
  it('cancels in-flight attempts (category shutdown) and rejects new work', async () => {
    const candidate = buildCandidate([{ name: 'skill', description: 'Example.', priority: 1, scope: 'tenant', body: 'x' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'e1', credentialAlias: 'alias-a' }) });
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'r', indexRaw: candidate.indexRaw, documents: candidate.documents, delayMs: 60_000 }],
    ]);
    const service = makeService({ policy }, fixtures);

    const attempt = service.refresh('tenant-a', 'startup');
    expect(attempt.state).toBe('in_progress');

    service.shutdown();
    await vi.waitFor(() => {
      expect(attempt.state).not.toBe('in_progress');
    });
    expect(attempt.state).toBe('rejected');
    expect(attempt.category).toBe('shutdown');

    const rejectedAfterShutdown = service.refresh('tenant-b', 'manual');
    expect(rejectedAfterShutdown.state).toBe('rejected');
    expect(rejectedAfterShutdown.category).toBe('shutdown');
  });
});
