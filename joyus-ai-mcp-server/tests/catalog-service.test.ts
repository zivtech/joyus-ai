import { vi, describe, it, expect } from 'vitest';

import { createFakePolicyReader, type FakePolicyAuthority } from '../src/skills/catalog/policy-s3.js';
import { CatalogMemoryLedger } from '../src/skills/catalog/service-budget.js';
import { createFakeCatalogSourcePort, type FakeSourceFixture } from '../src/skills/catalog/service-source.js';
import { createCatalogService } from '../src/skills/catalog/service.js';
import { computeLogicalSourceKey, sourceBindingRevision, type RefreshAttempt } from '../src/skills/catalog/types.js';
import { buildCandidate, buildPolicy, FakeClock, immediateSleep, tenantEntry } from './catalog-fixtures.js';

const MiB = 1024 * 1024;

async function waitFinished(attempt: RefreshAttempt): Promise<void> {
  await vi.waitFor(() => {
    expect(attempt.state).not.toBe('in_progress');
  });
}

function makeService(policyAuthority: FakePolicyAuthority, fixtures: Map<string, FakeSourceFixture>, clock: FakeClock) {
  return createCatalogService({
    policyReader: createFakePolicyReader(policyAuthority),
    sourcePort: createFakeCatalogSourcePort(fixtures),
    resolveCredential: (alias) => `secret-for-${alias}`,
    clock,
    sleep: immediateSleep(),
  });
}

describe('CatalogService freshness table', () => {
  it('is fresh right after activation, stale past 5 minutes, unavailable past 1 hour', async () => {
    const clock = new FakeClock();
    const candidate = buildCandidate([{ name: 'example-skill', description: 'Example knowledge.', priority: 10, scope: 'tenant', body: 'Body text.' }]);
    const policy = buildPolicy({
      'tenant-a': tenantEntry({ epoch: 'epoch-1', credentialAlias: 'alias-a' }),
    });
    const authority: FakePolicyAuthority = { policy };
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-1', indexRaw: candidate.indexRaw, documents: candidate.documents }],
    ]);
    const service = makeService(authority, fixtures, clock);

    const attempt = service.refresh('tenant-a', 'startup');
    await waitFinished(attempt);
    expect(attempt.state).toBe('activated');

    const logicalSourceKey = computeLogicalSourceKey('tenant-a', policy.tenants['tenant-a'].source);
    const generation = service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source));
    expect(generation).toBeDefined();
    expect(service.computeFreshness(generation!)).toBe('fresh');

    clock.advance(5 * 60 * 1000);
    expect(service.computeFreshness(generation!)).toBe('stale');

    clock.advance(60 * 60 * 1000);
    expect(service.computeFreshness(generation!)).toBe('unavailable');
    expect(service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeUndefined();
  });

  it('marks unavailable immediately on a source 401/403 and until successful re-verification', async () => {
    const clock = new FakeClock();
    const candidate = buildCandidate([{ name: 'example-skill', description: 'Example knowledge.', priority: 10, scope: 'tenant', body: 'Body text.' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-1', credentialAlias: 'alias-a' }) });
    const authority: FakePolicyAuthority = { policy };
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-1', indexRaw: candidate.indexRaw, documents: candidate.documents }],
    ]);
    const service = makeService(authority, fixtures, clock);

    const first = service.refresh('tenant-a', 'startup');
    await waitFinished(first);
    const logicalSourceKey = computeLogicalSourceKey('tenant-a', policy.tenants['tenant-a'].source);
    expect(service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeDefined();

    // Rotate to a denied credential: the fixture map no longer has an entry for it.
    authority.policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-2', credentialAlias: 'alias-denied' }) });
    fixtures.set('secret-for-alias-denied', {
      revision: 'rev-1',
      indexRaw: candidate.indexRaw,
      documents: candidate.documents,
      failure: { category: 'source_authorization', message: 'source credential was rejected' },
    });

    const second = service.refresh('tenant-a', 'manual');
    await waitFinished(second);
    expect(second.state).toBe('rejected');
    expect(second.category).toBe('source_authorization');
    // Old epoch's generation is now unreachable regardless of cache age.
    expect(service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeUndefined();
  });
});

describe('CatalogService invalid candidates', () => {
  it('does not move the prior generation verifiedAt on a failed refresh', async () => {
    const clock = new FakeClock();
    const candidate = buildCandidate([{ name: 'example-skill', description: 'Example knowledge.', priority: 10, scope: 'tenant', body: 'Body text.' }]);
    const policy = buildPolicy({ 'tenant-a': tenantEntry({ epoch: 'epoch-1', credentialAlias: 'alias-a' }) });
    const authority: FakePolicyAuthority = { policy };
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-1', indexRaw: candidate.indexRaw, documents: candidate.documents }],
    ]);
    const service = makeService(authority, fixtures, clock);

    const first = service.refresh('tenant-a', 'startup');
    await waitFinished(first);
    const logicalSourceKey = computeLogicalSourceKey('tenant-a', policy.tenants['tenant-a'].source);
    const originalGeneration = service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source));
    expect(originalGeneration).toBeDefined();

    clock.advance(1000);
    fixtures.set('secret-for-alias-a', {
      revision: 'rev-1',
      indexRaw: candidate.indexRaw,
      documents: candidate.documents,
      failure: { category: 'upstream_failure', message: 'source returned a server error' },
    });

    const second = service.refresh('tenant-a', 'manual');
    await waitFinished(second);
    expect(second.state).toBe('rejected');

    const stillOriginal = service.getActiveGeneration(logicalSourceKey, sourceBindingRevision(policy.tenants['tenant-a'].source));
    expect(stillOriginal).toBe(originalGeneration);
    expect(stillOriginal!.verifiedAtMonotonicMs).toBe(originalGeneration!.verifiedAtMonotonicMs);
    // A subsequent failure makes it stale even though it is well under 5 minutes old.
    expect(service.computeFreshness(stillOriginal!)).toBe('stale');
  });
});

describe('CatalogService independent tenant epochs', () => {
  it('keeps two tenants sharing the same repository/ref independently eligible', async () => {
    const clock = new FakeClock();
    const candidateA = buildCandidate([{ name: 'skill-a', description: 'Example knowledge A.', priority: 10, scope: 'tenant', body: 'Body A.' }]);
    const candidateB = buildCandidate([{ name: 'skill-b', description: 'Example knowledge B.', priority: 5, scope: 'tenant', body: 'Body B.' }]);
    const policy = buildPolicy({
      'tenant-a': tenantEntry({ epoch: 'epoch-a1', credentialAlias: 'alias-a' }),
      'tenant-b': tenantEntry({ epoch: 'epoch-b1', credentialAlias: 'alias-b' }),
    });
    const authority: FakePolicyAuthority = { policy };
    const fixtures = new Map<string, FakeSourceFixture>([
      ['secret-for-alias-a', { revision: 'rev-a', indexRaw: candidateA.indexRaw, documents: candidateA.documents }],
      ['secret-for-alias-b', { revision: 'rev-b', indexRaw: candidateB.indexRaw, documents: candidateB.documents }],
    ]);
    const service = makeService(authority, fixtures, clock);

    const attemptA = service.refresh('tenant-a', 'startup');
    const attemptB = service.refresh('tenant-b', 'startup');
    await waitFinished(attemptA);
    await waitFinished(attemptB);

    const keyA = computeLogicalSourceKey('tenant-a', policy.tenants['tenant-a'].source);
    const keyB = computeLogicalSourceKey('tenant-b', policy.tenants['tenant-b'].source);
    expect(service.getActiveGeneration(keyA, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeDefined();
    expect(service.getActiveGeneration(keyB, sourceBindingRevision(policy.tenants['tenant-b'].source))).toBeDefined();

    // Disabling tenant-a (new epoch) must not disturb tenant-b's independent eligibility.
    authority.policy = buildPolicy({
      'tenant-a': tenantEntry({ epoch: 'epoch-a2', credentialAlias: 'alias-a', enabled: false }),
      'tenant-b': tenantEntry({ epoch: 'epoch-b1', credentialAlias: 'alias-b' }),
    });
    await service.runConfiguredRefresh('timer');
    expect(service.getActiveGeneration(keyA, sourceBindingRevision(policy.tenants['tenant-a'].source))).toBeUndefined();
    expect(service.getActiveGeneration(keyB, sourceBindingRevision(policy.tenants['tenant-b'].source))).toBeDefined();
  });
});

describe('CatalogMemoryLedger (32 MiB active / 64 MiB aggregate budget)', () => {
  it('admits candidate reservations until the 64 MiB aggregate is exhausted', () => {
    const ledger = new CatalogMemoryLedger();
    expect(ledger.reserveCandidateBytes(40 * MiB)).toBe(true);
    expect(ledger.reserveCandidateBytes(30 * MiB)).toBe(false);
    expect(ledger.snapshot().candidateBytes).toBe(40 * MiB);
  });

  it('rejects activation beyond the 32 MiB active cap without evicting another source', () => {
    const ledger = new CatalogMemoryLedger();
    expect(ledger.reserveCandidateBytes(20 * MiB)).toBe(true);
    ledger.activate('source-a', 20 * MiB);
    expect(ledger.canActivate('source-b', 13 * MiB)).toBe(false);
    expect(ledger.canActivate('source-a', 25 * MiB)).toBe(true); // replacement of its own bytes still fits
    expect(ledger.snapshot().activeBytes).toBe(20 * MiB);
  });

  it('allows a same-size replacement to proceed exactly at the active cap', () => {
    const ledger = new CatalogMemoryLedger();
    ledger.reserveCandidateBytes(32 * MiB);
    ledger.activate('source-a', 32 * MiB);
    expect(ledger.canActivate('source-a', 32 * MiB)).toBe(true);
  });
});
