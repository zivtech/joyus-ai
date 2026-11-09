import { afterEach, describe, expect, it, vi } from 'vitest';

import { CATALOG_LIMITS } from '../src/skills/catalog/config.js';
import { CatalogMemoryLedger } from '../src/skills/catalog/service-budget.js';
import { CandidateReservation } from '../src/skills/catalog/service-reservation.js';
import type { CatalogSourcePort } from '../src/skills/catalog/service-source.js';
import { createCatalogService, type CatalogService } from '../src/skills/catalog/service.js';
import { fail, ok, type RefreshAttempt } from '../src/skills/catalog/types.js';
import { buildCandidate, buildPolicy, tenantEntry } from './catalog-fixtures.js';

const candidate = buildCandidate([
  { name: 'example', description: 'Example.', priority: 1, scope: 'tenant', body: 'Original body.' },
]);
const policy = buildPolicy(Object.fromEntries(['tenant-a', 'tenant-b'].map((tenant) => [
  tenant, tenantEntry({ epoch: '00000000-0000-4000-8000-000000000001', credentialAlias: tenant }),
])));
const services: CatalogService[] = [];
afterEach(() => services.splice(0).forEach((service) => service.shutdown()));

function snapshot(service: CatalogService) {
  return (service as unknown as { ledger: CatalogMemoryLedger }).ledger.snapshot();
}

function makeService(fetchDocuments: CatalogSourcePort['fetchDocuments']) {
  const service = createCatalogService({
    policyReader: { readPolicy: async () => ({ ok: true, policy }) },
    resolveCredential: (alias) => alias,
    sourcePort: {
      resolveCandidate: async () => ok({ revision: 'a'.repeat(40), indexRaw: candidate.indexRaw }),
      fetchDocuments,
    },
  });
  services.push(service);
  return service;
}

async function finished(attempt: RefreshAttempt) {
  await vi.waitFor(() => expect(attempt.state).not.toBe('in_progress'));
}

describe('service streaming reservation ownership', () => {
  it('uses admitted credits at capacity and cannot release another attempt’s bytes', () => {
    const ledger = new CatalogMemoryLedger();
    const cap = CATALOG_LIMITS.MAX_TOTAL_DOCUMENT_BYTES;
    expect(ledger.reserveCandidateBytes(cap)).toBe(true);
    const reservation = new CandidateReservation(ledger, 100);
    expect(reservation.reserve(100)).toBe(true);
    expect(reservation.reserve(1)).toBe(false);
    expect(() => reservation.release(101)).toThrow('Invalid catalog reservation release');
    expect(ledger.snapshot().candidateBytes).toBe(cap);
    reservation.dispose();
    reservation.dispose();
    reservation.release(100);
    expect(reservation.reserve(1)).toBe(false);
    expect(reservation.transfer(0)).toBe(false);
    expect(ledger.snapshot().candidateBytes).toBe(cap - 100);
  });

  it('requires actual streamed-byte agreement and releases unused admission credits', () => {
    const ledger = new CatalogMemoryLedger();
    expect(ledger.reserveCandidateBytes(100)).toBe(true);
    const reservation = new CandidateReservation(ledger, 100);
    expect(reservation.reserve(-1)).toBe(false);
    expect(reservation.reserve(Number.NaN)).toBe(false);
    expect(reservation.reserve(70)).toBe(true);
    expect(reservation.transfer(69)).toBe(false);
    expect(ledger.snapshot().candidateBytes).toBe(100);
    expect(reservation.transfer(70)).toBe(true);
    ledger.activate('example-source', 70);
    reservation.dispose();
    expect(ledger.snapshot()).toEqual({ activeBytes: 70, candidateBytes: 0, retiredBytes: 0, totalBytes: 70 });
  });

  it('counts streamed bytes once and leaves no candidate bytes after repeated activation', async () => {
    const service = makeService(async (params) => {
      expect(params.reserveDocumentBytes(candidate.totalBytes + 17)).toBe(true);
      params.releaseDocumentBytes(17); // Transport estimate shrinks to decoded bytes.
      expect(snapshot(service).candidateBytes).toBe(candidate.totalBytes);
      return ok(candidate.documents);
    });
    for (let i = 0; i < 3; i += 1) {
      const attempt = service.refresh('tenant-a', 'manual');
      await finished(attempt);
      expect(attempt.state).toBe('activated');
      expect(snapshot(service)).toEqual({
        activeBytes: candidate.totalBytes, candidateBytes: 0, retiredBytes: 0,
        totalBytes: candidate.totalBytes,
      });
    }
  });

  it.each(['validation', 'throw', 'adapter-cleanup'] as const)(
    'releases only the rejected attempt while a second candidate is held: %s', async (mode) => {
      let releaseHeld!: () => void;
      const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
      let holding = false;
      const service = makeService(async (params) => {
        expect(params.reserveDocumentBytes(candidate.totalBytes)).toBe(true);
        if (params.credential === 'tenant-b') {
          holding = true;
          await held;
          return ok(candidate.documents);
        }
        if (mode === 'throw') throw new Error('synthetic transport failure');
        if (mode === 'adapter-cleanup') {
          params.releaseDocumentBytes(candidate.totalBytes);
          return fail('upstream_failure', 'synthetic failure');
        }
        const invalid = new Map(candidate.documents);
        invalid.set('skills/example/SKILL.md', new TextEncoder().encode('invalid document'));
        return ok(invalid);
      });
      const second = service.refresh('tenant-b', 'manual');
      await vi.waitFor(() => expect(holding).toBe(true));
      try {
        const first = service.refresh('tenant-a', 'manual');
        await finished(first);
        expect(first.state).toBe('rejected');
        expect(snapshot(service).candidateBytes).toBe(candidate.totalBytes);
      } finally {
        releaseHeld();
        await finished(second);
      }
      expect(second.state).toBe('activated');
      expect(snapshot(service).candidateBytes).toBe(0);
      expect(snapshot(service).totalBytes).toBe(candidate.totalBytes);
    },
  );
});
