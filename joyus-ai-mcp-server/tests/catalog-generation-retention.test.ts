import { afterEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_LIMITS } from '../src/skills/catalog/config.js';
import { createFakePolicyReader, type FakePolicyAuthority } from '../src/skills/catalog/policy-s3.js';
import { createCatalogService, type CatalogService } from '../src/skills/catalog/service.js';
import type { CatalogMemoryLedger } from '../src/skills/catalog/service-budget.js';
import { createFakeCatalogSourcePort } from '../src/skills/catalog/service-source.js';
import { computeLogicalSourceKey, sourceBindingRevision, type Generation } from '../src/skills/catalog/types.js';
import { buildCandidate, buildPolicy, tenantEntry } from './catalog-fixtures.js';

const candidate = buildCandidate([
  { name: 'example', description: 'Example.', priority: 1, scope: 'tenant', body: 'Original body.' },
]);
const entry = tenantEntry({ epoch: 'epoch-1', credentialAlias: 'example-alias' });
const key = computeLogicalSourceKey('tenant-a', entry.source);
const services: CatalogService[] = [];
afterEach(() => services.splice(0).forEach((service) => service.shutdown()));

function setup() {
  const authority: FakePolicyAuthority = { policy: buildPolicy({ 'tenant-a': entry }) };
  const service = createCatalogService({
    policyReader: createFakePolicyReader(authority),
    resolveCredential: () => 'synthetic-credential',
    sourcePort: createFakeCatalogSourcePort(new Map([
      ['synthetic-credential', { revision: 'a'.repeat(40), ...candidate }],
    ])),
  });
  services.push(service);
  const ledger = (service as unknown as { ledger: CatalogMemoryLedger }).ledger;
  return { authority, service, ledger };
}

async function activate(service: CatalogService): Promise<Generation> {
  const attempt = service.refresh('tenant-a', 'manual');
  await vi.waitFor(() => expect(attempt.state).not.toBe('in_progress'));
  expect(attempt.state).toBe('activated');
  const generation = service.getActiveGeneration(key, sourceBindingRevision(entry.source));
  expect(generation).toBeDefined();
  return generation!;
}

describe('distinct held generations at the same revision and epoch', () => {
  it.each(['replace', 'disable', 'remove'] as const)(
    'retains every generation through %s and releases pins independently', async (mode) => {
      const { authority, service, ledger } = setup();
      const first = await activate(service);
      service.pinGeneration(first);
      service.pinGeneration(first);
      const second = await activate(service);
      service.pinGeneration(second);
      expect(second).not.toBe(first);
      expect(second.revision).toBe(first.revision);
      expect(second.epoch).toBe(first.epoch);

      let activeBytes = 0;
      if (mode === 'replace') {
        await activate(service);
        activeBytes = candidate.totalBytes;
      } else {
        authority.policy = buildPolicy(mode === 'remove' ? {} : {
          'tenant-a': { ...entry, enabled: false },
        });
        await service.runConfiguredRefresh('timer');
        expect(service.getActiveGeneration(key, sourceBindingRevision(entry.source))).toBeUndefined();
      }

      expect(ledger.snapshot()).toEqual({
        activeBytes, candidateBytes: 0, retiredBytes: 2 * candidate.totalBytes,
        totalBytes: activeBytes + 2 * candidate.totalBytes,
      });
      // Two pins on one retired object must retain its bytes until both reads finish.
      service.releaseGeneration(first);
      expect(ledger.snapshot().retiredBytes).toBe(2 * candidate.totalBytes);
      service.releaseGeneration(first);
      expect(ledger.snapshot().retiredBytes).toBe(candidate.totalBytes);
      service.releaseGeneration(first); // Duplicate cleanup cannot release the other object.
      expect(ledger.snapshot().retiredBytes).toBe(candidate.totalBytes);
      service.pinGeneration(second); // New pin on an already retired object.
      service.releaseGeneration(second);
      expect(ledger.snapshot().retiredBytes).toBe(candidate.totalBytes);
      service.releaseGeneration(second);
      expect(ledger.snapshot().totalBytes).toBe(activeBytes);
    },
  );

  it('rejects aggregate over-admission and recovers capacity in reverse release order', async () => {
    const { service, ledger } = setup();
    const first = await activate(service);
    service.pinGeneration(first);
    const second = await activate(service);
    service.pinGeneration(second);
    await activate(service);
    const remaining = CATALOG_LIMITS.MAX_TOTAL_DOCUMENT_BYTES - 3 * candidate.totalBytes;
    expect(ledger.reserveCandidateBytes(remaining)).toBe(true);
    expect(ledger.reserveCandidateBytes(1)).toBe(false);
    service.releaseGeneration(second);
    expect(ledger.reserveCandidateBytes(candidate.totalBytes)).toBe(true);
    expect(ledger.reserveCandidateBytes(1)).toBe(false);
    service.releaseGeneration(first);
    expect(ledger.reserveCandidateBytes(candidate.totalBytes)).toBe(true);
    expect(ledger.reserveCandidateBytes(1)).toBe(false);
    ledger.releaseCandidateBytes(remaining + 2 * candidate.totalBytes);
    expect(ledger.snapshot()).toEqual({
      activeBytes: candidate.totalBytes, candidateBytes: 0, retiredBytes: 0,
      totalBytes: candidate.totalBytes,
    });
  });
});
