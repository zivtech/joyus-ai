import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CorrectionStore } from '../../../src/enforcement/corrections/capture.js';
import type { Correction } from '../../../src/enforcement/types.js';

function makeCorrection(overrides: Partial<Correction> = {}): Correction {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    skillId: 'drupal-security',
    originalOutput: 'db_query("SELECT * FROM users")',
    correctedOutput: '\\Drupal::database()->select("users")->execute()',
    ...overrides,
  };
}

describe('CorrectionStore', () => {
  let testDir: string;
  let store: CorrectionStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `corrections-test-${Date.now()}`);
    store = new CorrectionStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('records a correction and returns its ID', () => {
    const correction = makeCorrection();
    const id = store.record(correction);
    expect(id).toBe(correction.id);
  });

  it('lists recorded corrections', () => {
    store.record(makeCorrection({ skillId: 'drupal-security' }));
    store.record(makeCorrection({ skillId: 'drupal-coding-standards' }));
    store.record(makeCorrection({ skillId: 'drupal-security' }));

    const all = store.list();
    expect(all).toHaveLength(3);
  });

  it('filters by skillId', () => {
    store.record(makeCorrection({ skillId: 'drupal-security' }));
    store.record(makeCorrection({ skillId: 'drupal-coding-standards' }));
    store.record(makeCorrection({ skillId: 'drupal-security' }));

    const filtered = store.list({ skillId: 'drupal-security' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.skillId === 'drupal-security')).toBe(true);
  });

  it('returns empty list for new store', () => {
    const result = store.list();
    expect(result).toEqual([]);
  });

  it('validates correction before recording', () => {
    const invalid = { id: 'not-a-uuid' } as unknown as Correction;
    expect(() => store.record(invalid)).toThrow();
  });
});
