import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditIndex } from '../../../src/enforcement/audit/index.js';
import { AuditWriter } from '../../../src/enforcement/audit/writer.js';
import type { AuditEntry } from '../../../src/enforcement/types.js';

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    actionType: 'gate-execution',
    result: 'pass',
    userTier: 'tier-2',
    activeSkills: ['drupal-coding-standards'],
    details: {},
    ...overrides,
  };
}

describe('AuditIndex', () => {
  let testDir: string;
  let dbPath: string;
  let auditDir: string;
  let index: AuditIndex;

  beforeEach(() => {
    testDir = join(tmpdir(), `audit-index-test-${Date.now()}`);
    auditDir = join(testDir, 'audit');
    dbPath = join(testDir, 'audit-index.db');
    mkdirSync(testDir, { recursive: true });

    index = new AuditIndex(dbPath);
    index.initialize();
  });

  afterEach(() => {
    index.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('query', () => {
    it('returns empty result when no entries', () => {
      const result = index.query();
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('queries entries after sync', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry({ actionType: 'gate-execution', result: 'pass' }));
      writer.write(makeEntry({ actionType: 'skill-load', result: 'pass' }));
      writer.write(makeEntry({ actionType: 'gate-execution', result: 'fail' }));

      index.syncFromJSONL(auditDir);

      const all = index.query();
      expect(all.total).toBe(3);

      const gatesOnly = index.query({ actionType: 'gate-execution' });
      expect(gatesOnly.total).toBe(2);

      const failsOnly = index.query({ result: 'fail' });
      expect(failsOnly.total).toBe(1);
    });

    it('supports pagination', () => {
      const writer = new AuditWriter(auditDir);
      for (let i = 0; i < 5; i++) {
        writer.write(makeEntry());
      }
      index.syncFromJSONL(auditDir);

      const page1 = index.query({ limit: 2, offset: 0 });
      expect(page1.entries).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      const page3 = index.query({ limit: 2, offset: 4 });
      expect(page3.entries).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });

    it('filters by skillId', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry({ skillId: 'drupal-security' }));
      writer.write(makeEntry({ skillId: 'drupal-coding-standards' }));
      writer.write(makeEntry({ skillId: 'drupal-security' }));
      index.syncFromJSONL(auditDir);

      const result = index.query({ skillId: 'drupal-security' });
      expect(result.total).toBe(2);
    });

    it('filters by taskId', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry({ taskId: 'PROJ-142' }));
      writer.write(makeEntry({ taskId: 'PROJ-143' }));
      index.syncFromJSONL(auditDir);

      const result = index.query({ taskId: 'PROJ-142' });
      expect(result.total).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns stats after sync', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry({ actionType: 'gate-execution', result: 'pass' }));
      writer.write(makeEntry({ actionType: 'gate-execution', result: 'fail' }));
      writer.write(makeEntry({ actionType: 'skill-load', result: 'pass' }));
      index.syncFromJSONL(auditDir);

      const stats = index.getStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.byActionType['gate-execution']).toBe(2);
      expect(stats.byActionType['skill-load']).toBe(1);
      expect(stats.byResult['pass']).toBe(2);
      expect(stats.byResult['fail']).toBe(1);
      expect(stats.dateRange.earliest).toBeTruthy();
    });
  });

  describe('syncFromJSONL', () => {
    it('syncs entries from JSONL files', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry());
      writer.write(makeEntry());

      const result = index.syncFromJSONL(auditDir);
      expect(result.newEntries).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('is idempotent — running twice does not duplicate', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry());

      index.syncFromJSONL(auditDir);
      index.syncFromJSONL(auditDir);

      const all = index.query();
      expect(all.total).toBe(1);
    });

    it('picks up new entries on subsequent sync', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry());
      index.syncFromJSONL(auditDir);

      writer.write(makeEntry());
      const result = index.syncFromJSONL(auditDir);
      expect(result.newEntries).toBe(1);

      const all = index.query();
      expect(all.total).toBe(2);
    });
  });

  describe('fullRebuild', () => {
    it('clears and reimports all entries', () => {
      const writer = new AuditWriter(auditDir);
      writer.write(makeEntry());
      writer.write(makeEntry());
      index.syncFromJSONL(auditDir);

      const result = index.fullRebuild(auditDir);
      expect(result.newEntries).toBe(2);

      const all = index.query();
      expect(all.total).toBe(2);
    });
  });
});
